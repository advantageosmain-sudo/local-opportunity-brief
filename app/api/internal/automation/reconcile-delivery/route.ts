import { ensureDatabase, getRuntimeEnv } from '@/db/runtime';
import { isAutomationRequest } from '@/lib/internal-auth';

const deliveredEvents = new Set(['delivered', 'opened', 'clicked']);
const failedEvents = new Set(['bounced', 'complained', 'failed', 'suppressed']);
const pendingEvents = new Set(['queued', 'scheduled', 'sent', 'delivery_delayed']);

export async function POST(request: Request) {
  if (!isAutomationRequest(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const env = getRuntimeEnv();
  if (!env.RESEND_API_KEY) return Response.json({ error: 'Provider unavailable' }, { status: 503 });
  // Receipt readback must remain possible after LIVE_DELIVERY stops new sends.
  const db = await ensureDatabase();
  const rows = (await db.prepare("SELECT * FROM delivery_attempts WHERE status IN ('accepted','delivered') AND created_at >= datetime('now','-30 days') ORDER BY CASE status WHEN 'accepted' THEN 0 ELSE 1 END, updated_at ASC LIMIT 50").all()).results as Record<string, string>[];
  let checked = 0;
  let confirmed = 0;
  let failed = 0;

  const readbackFailure = async (row: Record<string, string>, code: string) => {
    // Never persist or return provider bodies, headers, credentials or recipients.
    await db.prepare(`INSERT INTO diagnostics(id,system,subject_id,code) VALUES(?,'email',?,?)
      ON CONFLICT(id) DO UPDATE SET code=excluded.code,status='open',updated_at=CURRENT_TIMESTAMP`)
      .bind(`reconcile-${row.report_id}`, row.report_id, code).run();
    return Response.json({ error: 'Provider receipt could not be verified.', code, checked, confirmed, failed }, { status: 502 });
  };

  for (const row of rows) {
    if (!row.provider_message_id) return readbackFailure(row, 'PROVIDER_MESSAGE_ID_MISSING');
    checked++;
    let response: Response;
    try {
      response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(row.provider_message_id)}`, {
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
    } catch {
      return readbackFailure(row, 'PROVIDER_RECEIPT_REQUEST_FAILED');
    }
    // Authentication failures, throttling and outages must not produce a green
    // reconciliation run. Stop this pass without retrying or clearing send locks.
    if (!response.ok) return readbackFailure(row, `PROVIDER_RECEIPT_HTTP_${response.status}`);
    let result: { id?: unknown; last_event?: unknown } | null;
    try { result = await response.json(); }
    catch { return readbackFailure(row, 'PROVIDER_RECEIPT_INVALID_JSON'); }
    if (!result || result.id !== row.provider_message_id) return readbackFailure(row, 'PROVIDER_RECEIPT_ID_MISMATCH');
    const event = result.last_event;
    if (typeof event !== 'string' || ![...deliveredEvents, ...failedEvents, ...pendingEvents, 'canceled'].includes(event)) {
      return readbackFailure(row, 'PROVIDER_RECEIPT_STATUS_INVALID');
    }

    const now = new Date().toISOString();
    if (deliveredEvents.has(event)) {
      await db.batch([
        db.prepare("UPDATE delivery_attempts SET status='delivered',updated_at=? WHERE id=?").bind(now, row.id),
        db.prepare("UPDATE reports SET status='delivered',delivered_at=COALESCE(delivered_at,?) WHERE id=?").bind(now, row.report_id),
        db.prepare("UPDATE customers SET first_delivered_at=COALESCE(first_delivered_at,?) WHERE id=(SELECT customer_slug FROM reports WHERE id=? AND json_extract(report_json,'$.report.customer.deliveryMode')='customer') AND email=?").bind(now, row.report_id, row.recipient),
        db.prepare("UPDATE markets SET first_approved_at=COALESCE(first_approved_at,?) WHERE id=(SELECT market_id FROM customers WHERE id=(SELECT customer_slug FROM reports WHERE id=? AND json_extract(report_json,'$.report.customer.deliveryMode')='customer') AND email=?)").bind(now, row.report_id, row.recipient),
      ]);
      if (row.status === 'accepted') confirmed++;
    } else if (failedEvents.has(event) || event === 'canceled') {
      const statements = [
        db.prepare("UPDATE delivery_attempts SET status='failed',updated_at=? WHERE id=?").bind(now, row.id),
        db.prepare("INSERT OR REPLACE INTO diagnostics(id,system,subject_id,code) VALUES(?,'email',?,?)").bind(`delivery-${row.report_id}`, row.report_id, event === 'canceled' ? 'PROVIDER_DELIVERY_CANCELED' : 'PROVIDER_DELIVERY_FAILED'),
      ];
      // A canceled message is not evidence that its recipient is unsafe.
      if (failedEvents.has(event)) {
        statements.push(db.prepare("UPDATE customers SET delivery_status='suppressed' WHERE id=(SELECT customer_slug FROM reports WHERE id=? AND json_extract(report_json,'$.report.customer.deliveryMode')='customer') AND email=?").bind(row.report_id, row.recipient));
      }
      await db.batch(statements);
      failed++;
    } else {
      // Rotate valid pending receipts so a full batch cannot starve later rows.
      await db.prepare('UPDATE delivery_attempts SET updated_at=? WHERE id=?').bind(now, row.id).run();
    }
    await db.prepare("UPDATE diagnostics SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='open'").bind(`reconcile-${row.report_id}`).run();
  }
  return Response.json({ checked, confirmed, failed });
}

