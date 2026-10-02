import { automationEndpoint } from "./hosted-client.mjs";

// The hosted service owns provider requests, durable state and suppression.
// This caller never receives or stores the provider API key.
export async function reconcileHostedDelivery({ env = process.env, fetchImpl = fetch } = {}) {
  if (env.LIVE_DELIVERY !== "1") return { status: "SKIPPED", reason: "LIVE_DELIVERY_DISABLED" };
  const endpoint = automationEndpoint("reconcile-delivery", env);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${env.REPORT_SYNC_SECRET}`, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  // Never log provider response bodies, headers, bearer tokens or customer data.
  if (!response.ok) throw new Error(`RECEIPT_RECONCILIATION_HTTP_${response.status}`);
  const result = await response.json();
  if (!Number.isSafeInteger(result.checked) || !Number.isSafeInteger(result.confirmed) || result.checked < 0 || result.confirmed < 0 || result.confirmed > result.checked) throw new Error("RECEIPT_RECONCILIATION_INVALID_RESPONSE");
  return { status: "RECONCILED", checked: result.checked, confirmed: result.confirmed };
}
