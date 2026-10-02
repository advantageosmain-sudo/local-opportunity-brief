import { ensureDatabase, getRuntimeEnv } from "@/db/runtime";
import { validateReportSyncPayload } from "@/lib/report-sync.mjs";
import { secureStringEqual } from "@/lib/security.mjs";

export async function POST(request: Request) {
  const env = getRuntimeEnv();
  const expectedSecret = env.REPORT_SYNC_SECRET;
  const suppliedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expectedSecret || !secureStringEqual(suppliedSecret, expectedSecret)) {
    return Response.json({ error: "Report synchronization is not authorized." }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 500_000) {
    return Response.json({ error: "Report packet is too large." }, { status: 413 });
  }

  let payload;
  try {
    const raw=await request.text();
    if(raw.length>500000) return Response.json({error:"Report packet too large."},{status:413});
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Report packet could not be read." }, { status: 400 });
  }
  if (payload?.deliveryReceipt) return Response.json({error:"Delivery evidence must originate from provider reconciliation."},{status:400});
  const checked = await validateReportSyncPayload(payload);
  if (!checked.passed) {
    return Response.json({ error: "Report packet failed validation.", details: checked.errors }, { status: 400 });
  }

  try {
    const database = await ensureDatabase();
    const report = payload.report;
    const existing = await database.prepare('SELECT report_json FROM reports WHERE id=?').bind(report.reportId).first<{report_json:string}>();
    if(existing) {
      const prior=JSON.parse(existing.report_json);
      if(prior.report.checksum!==report.checksum) return Response.json({error:'A different report version already exists for this identity. Explicit revision required.'},{status:409});
      return Response.json({status:'ALREADY_SAVED',reportId:report.reportId});
    }
    const status = payload.deliveryReceipt
      ? "delivered"
      : report.fixture
        ? "demo_pending_approval"
        : "pending_approval";
    await database
      .prepare(
        `INSERT OR IGNORE INTO reports (id, customer_slug, business_name, week_of, status, report_json, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        report.reportId,
        report.customer.slug,
        report.customer.businessName,
        report.weekOf,
        status,
        JSON.stringify(payload),
        payload.deliveryReceipt?.deliveredAt ?? null,
      )
      .run();
    const saved=await database.prepare('SELECT report_json FROM reports WHERE id=?').bind(report.reportId).first<{report_json:string}>();
    if(!saved||JSON.parse(saved.report_json).report.checksum!==report.checksum) return Response.json({error:'Conflicting immutable report.'},{status:409});
    return Response.json({ status: "SAVED", reportId: report.reportId }, { status: 201 });
  } catch {
    console.error("report_sync_failed");
    return Response.json({ error: "Report could not be saved." }, { status: 503 });
  }
}

