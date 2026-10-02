import { ensureDatabase, getRuntimeEnv } from '@/db/runtime';
import { isAutomationRequest } from '@/lib/internal-auth';

const deliveredEvents = new Set(['delivered', 'opened', 'clicked']);
const failedEvents = new Set(['bounced', 'complained', 'failed', 'suppressed']);
const pendingEvents = new Set(['queued', 'scheduled', 'sent', 'delivery_delayed']);

// Four sequential reads, including their bodies, plus three pacing intervals:
// at most 21.8s of provider wait, leaving 8.2s of the caller's 30s for DB/runtime.
const receiptBatchSize = 4;
const receiptTimeoutMs = 5_000;
const receiptSpacingMs = 600;

type ReceiptReadback = { result: { id?: unknown; last_event?: unknown } | null; code?: never } | { code: string; result?: never };

async function readProviderReceipt(messageId: string, apiKey: string): Promise<ReceiptReadback> {
  const controller = new AbortController();
  let readingBody = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Race the whole operation, not just headers. A stalled body (or a fetch
    // implementation that ignores abort) cannot keep this route waiting.
    return await Promise.race([
      (async (): Promise<ReceiptReadback> => {
        const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(messageId)}`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
          redirect: 'error',
        });
        controller.signal.throwIfAborted();
        if (!response.ok) return { code: `PROVIDER_RECEIPT_HTTP_${response.status}` };
        readingBody = true;
        return { result: await response.json() };
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Provider receipt deadline exceeded'));
          controller.abort();
        }, receiptTimeoutMs);
      }),
    ]);
  } catch {
    return { code: readingBody ? 'PROVIDER_RECEIPT_INVALID_JSON' : 'PROVIDER_RECEIPT_REQUEST_FAILED' };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export async function POST(request: Request) {
  if (!isAutomationRequest(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const env = getRuntimeEnv();
  if (!env.RESEND_API_KEY) return Response.json({ error: 'Provider unavailable' }, { status: 503 });
  // Receipt readback must remain possible after LIVE_DELIVERY stops new sends.
  const db = await ensureDatabase();
  // Order by last check across both statuses. Prioritizing all accepted rows
  // would let permanent failures monopolize the batch and hide later bounces.
  const rows = (await db.prepare(`SELECT * FROM delivery_attempts WHERE status IN ('accepted','delivered') AND created_at >= datetime('now','-30 days') ORDER BY julianday(updated_at) ASC, CASE status WHEN 'accepted' THEN 0 ELSE 1 END, id ASC LIMIT ${receiptBatchSize}`).all()).results as Record<string, string>[];
  let checked = 0;
  let confirmed = 0;
  let failed = 0;
  let firstFailureCode: string | undefined;

  const readbackFailure = async (row: Record<string, string>, code: string) => {
    // Never persist or return provider bodies, headers, credentials or recipients.
    // Rotate failures without clearing accepted/unknown send locks or inventing
    // a delivery outcome. Each selected row gets one chance in this pass.
    await db.batch([
      db.prepare(`INSERT INTO diagnostics(id,system,subject_id,code) VALUES(?,'email',?,?)
        ON CONFLICT(id) DO UPDATE SET code=excluded.code,status='open',updated_at=CURRENT_TIMESTAMP`)
        .bind(`reconcile-${row.report_id}`, row.report_id, code),
      db.prepare('UPDATE delivery_attempts SET updated_at=? WHERE id=?').bind(new Date().toISOString(), row.id),
    ]);
    firstFailureCode ??= code;
  };

  for (const row of rows) {
    if (!row.provider_message_id) {
      await readbackFailure(row, 'PROVIDER_MESSAGE_ID_MISSING');
      continue;
    }
    // Stay below the provider's default two-request/second limit within this
    // invocation; shared-key traffic from other invocations can still get 429s.
    if (checked > 0) await new Promise(resolve => setTimeout(resolve, receiptSpacingMs));
    checked++;
    const readback = await readProviderReceipt(row.provider_message_id, env.RESEND_API_KEY);
    if (readback.code) {
      await readbackFailure(row, readback.code);
      continue;
    }
    const result = readback.result;
    if (!result || result.id !== row.provider_message_id) {
      await readbackFailure(row, 'PROVIDER_RECEIPT_ID_MISMATCH');
      continue;
    }
    const event = result.last_event;
    if (typeof event !== 'string' || ![...deliveredEvents, ...failedEvents, ...pendingEvents, 'canceled'].includes(event)) {
      await readbackFailure(row, 'PROVIDER_RECEIPT_STATUS_INVALID');
      continue;
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
  // Partial progress is durable, but any unverified receipt still fails the run
  // visibly and preserves the existing safe one-row error response contract.
  if (firstFailureCode) return Response.json({ error: 'Provider receipt could not be verified.', code: firstFailureCode, checked, confirmed, failed }, { status: 502 });
  return Response.json({ checked, confirmed, failed });
}
