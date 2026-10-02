export function automationEndpoint(name, env = process.env) {
  if (!env.REPORT_SYNC_URL || !env.REPORT_SYNC_SECRET) throw new Error("Hosted automation requires REPORT_SYNC_URL and REPORT_SYNC_SECRET.");
  const url = new URL(env.REPORT_SYNC_URL);
  if (url.protocol !== "https:") throw new Error("Hosted automation must use HTTPS.");
  return new URL(`/api/internal/automation/${name}`, url.origin).href;
}

export async function readHostedCustomers({ env = process.env, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(automationEndpoint("customers", env), {
    headers: { authorization: `Bearer ${env.REPORT_SYNC_SECRET}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Customer export failed (${response.status}).`);
  const payload = await response.json();
  if (!Array.isArray(payload.customers)) throw new Error("Customer export is missing its customers array.");
  return payload;
}

export async function requestHostedDelivery({ report, env = process.env, fetchImpl = fetch }) {
  const response = await fetchImpl(automationEndpoint("deliver", env), {
    method: "POST", headers: { authorization: `Bearer ${env.REPORT_SYNC_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ reportId: report.reportId, checksum: report.checksum }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    // The server owns persistent claims and reconciliation. Never retry a timed-out
    // send in this client; a later run must inspect the same durable report state.
    throw new Error(`Hosted delivery blocked (${response.status}): ${result.reason ?? result.error ?? "inspect owner dashboard"}`);
  }
  return result;
}
