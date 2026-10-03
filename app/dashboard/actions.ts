"use server";

import type { D1Database } from "@/types/cloudflare-d1";

import { revalidatePath } from "next/cache";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureDatabase, getRuntimeEnv } from "@/db/runtime";
import { validateCurrentReportPacket } from "@/lib/report-sync.mjs";
import { isCurrentOwnerReport } from "@/lib/dashboard-policy.mjs";

const ALLOWED_LEAD_STATUSES = new Set([
  "new",
  "research_ready",
  "approved_for_test_checkout",
  "rejected",
]);

const ALLOWED_OUTCOMES = new Set([
  "not_tried",
  "engagement",
  "inquiry",
  "sale",
  "no_result",
]);

export async function setLeadPilotStatus(formData: FormData) {
  const actorEmail = await requireOwner();
  const leadId = String(formData.get("leadId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!isSafeId(leadId) || !ALLOWED_LEAD_STATUSES.has(status)) {
    throw new Error("Lead update is invalid.");
  }

  const database = await ensureDatabase();
  await database.batch([
    database
      .prepare("UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(status, leadId),
    auditStatement(database, "lead_status_changed", leadId, actorEmail, { status }),
  ]);
  revalidatePath("/dashboard");
}

export async function setReportDecision(formData: FormData) {
  const actorEmail = await requireOwner();
  const reportId = String(formData.get("reportId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const displayedChecksum=String(formData.get("checksum")??"");
  const note = String(formData.get("decisionNote") ?? "").trim().slice(0, 500);
  if (!isSafeId(reportId) || !["approve", "revise", "reopen"].includes(decision)) {
    throw new Error("Report decision is invalid.");
  }

  const database = await ensureDatabase();
  const row = await database
    .prepare("SELECT status, report_json FROM reports WHERE id = ? LIMIT 1")
    .bind(reportId)
    .first<{ report_json: string; status: string }>();
  if (!row) throw new Error("Report could not be found.");

  let packet;
  try {
    packet = JSON.parse(row.report_json);
  } catch {
    throw new Error("Report packet is invalid.");
  }
  if(displayedChecksum!==packet?.report?.checksum) throw new Error("Report changed since preview. Reload before deciding.");
  const isPending = ["pending_approval", "demo_pending_approval"].includes(row.status);
  const isDecided = ["owner_approved", "needs_revision"].includes(row.status);
  if (decision === "reopen" && !isDecided) {
    throw new Error("Only a decided report can be reopened.");
  }
  if (decision !== "reopen" && !isPending) {
    throw new Error("This report already has an owner decision.");
  }
  if (decision === "approve" && !(await validateCurrentReportPacket(packet)).passed) {
    throw new Error("A blocked report cannot be approved.");
  }
  if (decision === "approve" && packet?.report?.fixture === true) {
    throw new Error("A demonstration report cannot be approved.");
  }
  if (decision === "approve" && !isCurrentOwnerReport(packet?.report)) {
    throw new Error("This report is no longer current. Wait for the next weekly packet.");
  }

  const status =
    decision === "approve"
      ? "owner_approved"
      : decision === "revise"
        ? "needs_revision"
        : packet?.report?.fixture === true
          ? "demo_pending_approval"
          : "pending_approval";
  const approvedAt = decision === "approve" ? new Date().toISOString() : null;
  await database.batch([
    database
      .prepare("UPDATE reports SET status = ?, approved_at = ? WHERE id = ?")
      .bind(status, approvedAt, reportId),
    database.prepare(`INSERT INTO report_decisions(report_id,checksum,decision,actor_email,decided_at,notes) VALUES(?,?,?,?,?,?) ON CONFLICT(report_id,checksum) DO UPDATE SET decision=excluded.decision,actor_email=excluded.actor_email,decided_at=excluded.decided_at,notes=excluded.notes`).bind(reportId,packet.report.checksum,decision,actorEmail,new Date().toISOString(),note),
    auditStatement(database, "report_decision_recorded", reportId, actorEmail, {
      decision,
      note,
      checksum: packet?.report?.checksum ?? null,
      deliveryTriggered: false,
    }),
  ]);
  revalidatePath("/dashboard");
}

export async function saveOpportunityFeedback(formData: FormData) {
  const actorEmail = await requireOwner();
  const reportId = String(formData.get("reportId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const rating = Number(formData.get("rating"));
  const used = String(formData.get("used") ?? "no") === "yes" ? 1 : 0;
  const outcome = String(formData.get("outcome") ?? "not_tried");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 500);

  if (
    !isSafeId(reportId) ||
    !isSafeId(opportunityId) ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5 ||
    !ALLOWED_OUTCOMES.has(outcome)
  ) {
    throw new Error("Opportunity feedback is invalid.");
  }

  const database = await ensureDatabase();
  const row = await database
    .prepare("SELECT customer_slug, report_json FROM reports WHERE id = ? LIMIT 1")
    .bind(reportId)
    .first<{ customer_slug: string; report_json: string }>();
  if (!row || !reportContainsOpportunity(row.report_json, opportunityId)) {
    throw new Error("The selected report opportunity could not be verified.");
  }

  await database.batch([
    database
      .prepare(
        `INSERT INTO opportunity_feedback
          (id, report_id, customer_slug, opportunity_id, rating, used, outcome, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(report_id, opportunity_id) DO UPDATE SET
          rating = excluded.rating,
          used = excluded.used,
          outcome = excluded.outcome,
          notes = excluded.notes,
          updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(
        crypto.randomUUID(),
        reportId,
        row.customer_slug,
        opportunityId,
        rating,
        used,
        outcome,
        notes,
      ),
    auditStatement(database, "opportunity_feedback_saved", opportunityId, actorEmail, {
      reportId,
      rating,
      used: used === 1,
      outcome,
    }),
  ]);
  revalidatePath("/dashboard");
}

async function requireOwner() {
  const user = await getChatGPTUser();
  const ownerEmail = getRuntimeEnv().OWNER_EMAIL?.trim().toLowerCase();
  if (!user || !ownerEmail || user.email.trim().toLowerCase() !== ownerEmail) {
    throw new Error("Owner approval is required.");
  }
  return ownerEmail;
}

function isSafeId(value: string) {
  return /^[a-z0-9][a-z0-9-]{7,159}$/i.test(value);
}

function reportContainsOpportunity(reportJson: string, opportunityId: string) {
  try {
    const packet = JSON.parse(reportJson);
    return Boolean(
      packet?.report?.opportunities?.some(
        (opportunity: { id?: unknown }) => opportunity?.id === opportunityId,
      ),
    );
  } catch {
    return false;
  }
}

function auditStatement(
  database: D1Database,
  eventType: string,
  subjectId: string,
  actorEmail: string,
  detail: Record<string, unknown>,
) {
  return database
    .prepare(
      `INSERT INTO audit_events
        (id, event_type, subject_id, actor_email, detail_json)
      VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      eventType,
      subjectId,
      actorEmail,
      JSON.stringify(detail),
    );
}

export async function setCustomerStatus(formData: FormData) {
 const actor=await requireOwner();
 const id=String(formData.get('customerId')??'');
 const action=String(formData.get('action')??'');
 if(!isSafeId(id)||!['pause','resume','cancel'].includes(action)) throw new Error('Invalid customer action.');
 const db=await ensureDatabase();
 const customer=await db.prepare('SELECT payment_status,onboarding_status FROM customers WHERE id=?').bind(id).first<{payment_status:string;onboarding_status:string}>();
 if(!customer) throw new Error('Customer missing.');
 if(action==='resume'&&(customer.payment_status!=='active'||customer.onboarding_status!=='complete')) throw new Error('Active payment and completed intake required.');
 const status=action==='pause'?'paused':action==='cancel'?'canceled':'active';
 await db.batch([db.prepare('UPDATE customers SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status,id),auditStatement(db,'customer_status_changed',id,actor,{status,paymentSubscriptionChanged:false})]);
 revalidatePath('/dashboard');
}

export async function approveMarketSources(formData: FormData) {
 const actor=await requireOwner();
 const market=String(formData.get('marketId')??'');
 if(!isSafeId(market)) throw new Error('Invalid market.');
 const db=await ensureDatabase();
 const row=await db.prepare('SELECT source_registry_json FROM markets WHERE id=?').bind(market).first<{source_registry_json:string}>();
 if(!row) throw new Error('Market missing.');
 const packs=JSON.parse(row.source_registry_json);
 if(!Array.isArray(packs)||!packs.length||packs.some(p=>p.fixture||!Array.isArray(p.opportunities)||p.opportunities.length<5)) throw new Error('Five source-verified opportunities are required before approval.');
 await db.batch([db.prepare("UPDATE markets SET status='verified' WHERE id=?").bind(market),auditStatement(db,'market_sources_approved',market,actor,{packs:packs.map(p=>p.sourceFile)})]);
 revalidatePath('/dashboard');
}

export async function setReviewPolicy(formData:FormData) {
 const actor=await requireOwner();const id=String(formData.get('customerId')??'');
 const mode=String(formData.get('reviewPolicy')??'');if(!isSafeId(id)||!['every','progressive'].includes(mode))throw new Error('Invalid review policy.');
 const db=await ensureDatabase();await db.batch([db.prepare('UPDATE customers SET require_every_review=? WHERE id=?').bind(mode==='every'?1:0,id),auditStatement(db,'review_policy_changed',id,actor,{mode})]);revalidatePath('/dashboard');
}
