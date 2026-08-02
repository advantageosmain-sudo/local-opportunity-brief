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
    payload = await request.json();
  } catch {
    return Response.json({ error: "Report packet could not be read." }, { status: 400 });
  }
  const checked = await validateReportSyncPayload(payload);
  if (!checked.passed) {
    return Response.json({ error: "Report packet failed validation.", details: checked.errors }, { status: 400 });
  }

  try {
    const database = await ensureDatabase();
    const report = payload.report;
    const status = payload.deliveryReceipt
      ? "delivered"
      : report.fixture
        ? "demo_pending_approval"
        : "pending_approval";
    await database
      .prepare(
        `INSERT INTO reports (id, customer_slug, business_name, week_of, status, report_json, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           report_json = excluded.report_json,
           delivered_at = excluded.delivered_at`,
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
    return Response.json({ status: "SAVED", reportId: report.reportId }, { status: 201 });
  } catch (error) {
    console.error("report_sync_failed", error);
    return Response.json({ error: "Report could not be saved." }, { status: 503 });
  }
}
