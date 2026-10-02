import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { reconcileHostedDelivery } from "../lib/receipt-reconciliation.mjs";
const env = { LIVE_DELIVERY: "1", REPORT_SYNC_URL: "https://mock-hosted-service.co/api/internal/reports", REPORT_SYNC_SECRET: "mock-secret-not-real" };

test("receipt caller is disabled by default and makes no provider/network request", async () => {
  assert.deepEqual(await reconcileHostedDelivery({ env: {}, fetchImpl: () => assert.fail("No network while disabled") }), { status: "SKIPPED", reason: "LIVE_DELIVERY_DISABLED" });
});

test("receipt caller uses existing hosted secret, no redirects and a bounded request", async () => {
  let calls = 0;
  const result = await reconcileHostedDelivery({ env, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, "https://mock-hosted-service.co/api/internal/automation/reconcile-delivery");
    assert.equal(options.method, "POST");
    assert.equal(options.body, "{}");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.authorization, `Bearer ${env.REPORT_SYNC_SECRET}`);
    return Response.json({ checked: 4, confirmed: 2, privateField: "must-not-be-logged" });
  } });
  assert.deepEqual(result, { status: "RECONCILED", checked: 4, confirmed: 2 });
  assert.equal(calls, 1);
});

test("receipt provider unavailability fails safely without leaking body or retrying", async () => {
  let calls = 0;
  await assert.rejects(reconcileHostedDelivery({ env, fetchImpl: async () => {
    calls++;
    return new Response("secret provider detail", { status: 503 });
  } }), { message: "RECEIPT_RECONCILIATION_HTTP_503" });
  assert.equal(calls, 1);
});

test("receipt caller rejects malformed success and does not fabricate confirmations", async () => {
  for (const response of [{ checked: 0, confirmed: 1 }, { checked: -1, confirmed: 0 }, { checked: 1 }, { checked: "4", confirmed: 2 }]) {
    await assert.rejects(reconcileHostedDelivery({ env, fetchImpl: async () => Response.json(response) }), { message: "RECEIPT_RECONCILIATION_INVALID_RESPONSE" });
  }
});

test("hourly receipt workflow is owner-gated and failure alerts are deduplicated", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/reconcile-delivery.yml", import.meta.url), "utf8");
  assert.match(workflow, /cron: "43 \* \* \* \*"/);
  assert.match(workflow, /if: vars\.LIVE_DELIVERY == '1'/);
  assert.match(workflow, /github\.paginate/);
  assert.match(workflow, /issue\.body\?\.includes\(marker\)/);
  assert.doesNotMatch(workflow, /RESEND_API_KEY/);
});
