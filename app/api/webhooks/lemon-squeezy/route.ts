import { ensureDatabase, getRuntimeEnv } from "@/db/runtime";
import {
  leadStatusForTestEvent,
  parseTestWebhook,
  verifyLemonSqueezySignature,
} from "@/lib/lemon-squeezy.mjs";

export async function POST(request: Request) {
  const env = getRuntimeEnv();
  if (env.PAYMENTS_MODE !== "test") {
    return Response.json({ error: "Payment processing is disabled." }, { status: 503 });
  }
  if (!env.LEMON_SQUEEZY_WEBHOOK_SECRET) {
    return Response.json({ error: "Test webhook is not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!rawBody || rawBody.length > 1_000_000) {
    return Response.json({ error: "Webhook payload is invalid." }, { status: 400 });
  }
  const signature = request.headers.get("x-signature") ?? "";
  if (!(await verifyLemonSqueezySignature(rawBody, signature, env.LEMON_SQUEEZY_WEBHOOK_SECRET))) {
    return Response.json({ error: "Webhook signature is invalid." }, { status: 401 });
  }

  let event;
  try {
    event = parseTestWebhook(rawBody, request.headers.get("x-event-name") ?? "");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Webhook payload is invalid." },
      { status: 400 },
    );
  }

  try {
    const database = await ensureDatabase();
    const statements = [
      database
        .prepare(
          `INSERT OR IGNORE INTO payment_events
           (id, provider, event_name, external_id, payload_json)
           VALUES (?, 'lemon_squeezy_test', ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), event.eventName, event.externalId, rawBody),
    ];
    const leadStatus = leadStatusForTestEvent(event.eventName);
    if (event.leadId && leadStatus) {
      statements.push(
        database
          .prepare("UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(leadStatus, event.leadId),
      );
    }
    await database.batch(statements);
    return Response.json({ status: "ACCEPTED", testMode: true });
  } catch (error) {
    console.error("test_payment_webhook_failed", error);
    return Response.json({ error: "Test payment event could not be saved." }, { status: 503 });
  }
}
