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
  blockedSourceResults(payload);
  return payload;
}

// Only opaque identities and fixed codes cross into weekly diagnostics. These
// results never enter runCustomer or authorize source approval/delivery.
export function blockedSourceResults(payload, selectedCustomer = 'all') {
  if (payload.blockedSources === undefined && payload.blockedSourceCount === undefined) return [];
  if (!Array.isArray(payload.blockedSources) || payload.blockedSourceCount !== payload.blockedSources.length ||
      !payload.blockedSources.every(entry => entry && typeof entry === 'object' && !Array.isArray(entry) &&
        typeof entry.customerSlug === 'string' && entry.customerSlug.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.customerSlug) && !entry.customerSlug.startsWith('qa-') &&
        typeof entry.marketId === 'string' && /^[a-z0-9-]{1,160}$/.test(entry.marketId) &&
        ['MARKET_SOURCE_MISSING','MARKET_SOURCE_APPROVAL_REQUIRED','MARKET_SOURCE_FRESHNESS_EXPIRED','MARKET_SOURCE_INVALID'].includes(entry.code))) {
    throw new Error('Customer export has invalid blocked-source diagnostics.');
  }
  return payload.blockedSources.filter(entry => selectedCustomer === 'all' || entry.customerSlug === selectedCustomer)
    .map(entry => ({status:'BLOCKED',customerSlug:entry.customerSlug,marketId:entry.marketId,reason:entry.code,liveDelivery:false}));
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
