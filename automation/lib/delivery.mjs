// Low-level transport adapter. Production automation uses hosted-client.mjs so
// durable hosted approval, suppression and delivery claims are authoritative.
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateReport, renderMarkdown } from "./engine.mjs";
import { customerEligibility, isDeliverableEmail } from "./customer-policy.mjs";

export class DeliveryError extends Error {
  constructor(code, details = {}) { super(code); this.name = "DeliveryError"; this.code = code; this.details = details; }
}
export function deliveryIdempotencyKey(report) { return `weekly-brief/${report.reportId}/${report.checksum}`.slice(0, 256); }
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (filename) => JSON.parse(await readFile(filename, "utf8"));
async function exists(filename) { try { await access(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }

export async function deliverApprovedReport({ reportPath, env = process.env, fetchImpl = fetch, now = () => new Date(), authorizeDelivery }) {
  const resolved = path.resolve(reportPath);
  const dir = path.dirname(resolved);
  const report = await readJson(resolved);
  const validation = await readJson(path.join(dir, "validation.json"));
  if (!validation.passed || !validateReport(report).passed) throw new DeliveryError("REPORT_VALIDATION_FAILED");
  if (report.fixture) throw new DeliveryError("FIXTURE_REPORT_CANNOT_BE_DELIVERED");
  if (!report.deliveryEligible || report.customer.deliveryMode !== "customer") throw new DeliveryError("REPORT_NOT_ELIGIBLE_FOR_CUSTOMER_DELIVERY");
  if (!isDeliverableEmail(report.customer.deliveryEmail)) throw new DeliveryError("INVALID_DELIVERY_RECIPIENT");
  // An editable approval.json or CI actor alone is never an approval credential.
  if (typeof authorizeDelivery !== "function") throw new DeliveryError("DURABLE_AUTHORIZATION_REQUIRED");
  const authorization = await authorizeDelivery(report);
  if (authorization?.allowed !== true || authorization.reportId !== report.reportId || authorization.checksum !== report.checksum) throw new DeliveryError("DURABLE_AUTHORIZATION_DENIED");
  if (!customerEligibility(authorization.customer).eligible || authorization.customer.deliveryEmail !== report.customer.deliveryEmail) throw new DeliveryError("CUSTOMER_NO_LONGER_ELIGIBLE");
  if (env.LIVE_DELIVERY !== "1") throw new DeliveryError("LIVE_DELIVERY_DISABLED");
  if (!env.RESEND_API_KEY) throw new DeliveryError("RESEND_API_KEY_MISSING");
  if (!env.DELIVERY_FROM_EMAIL) throw new DeliveryError("DELIVERY_FROM_EMAIL_MISSING");
  const receiptPath = path.join(dir, "delivery-receipt.json");
  const claimPath = path.join(dir, "delivery-claim.json");
  const failurePath = path.join(dir, "delivery-failure.json");
  const uncertainPath = path.join(dir, "delivery-uncertain.json");
  if (await exists(receiptPath)) throw new DeliveryError("DELIVERY_RECEIPT_ALREADY_EXISTS");
  if (await exists(uncertainPath)) throw new DeliveryError("PREVIOUS_DELIVERY_OUTCOME_IS_UNCERTAIN");
  if (await exists(path.join(dir, "recipient-suppression.json"))) throw new DeliveryError("RECIPIENT_SUPPRESSED");
  let previousFailure;
  if (await exists(failurePath)) {
    previousFailure = await readJson(failurePath);
    if (!previousFailure.retryable) throw new DeliveryError("DELIVERY_REQUIRES_OWNER_RECONCILIATION");
    if (previousFailure.attemptCount >= 3) throw new DeliveryError("DELIVERY_RETRY_LIMIT_REACHED");
    if (new Date(previousFailure.retryAfter) > now()) throw new DeliveryError("DELIVERY_RETRY_BACKOFF_ACTIVE");
  }
  // Read bytes before claiming, so missing local content cannot strand a send claim.
  const markdown = renderMarkdown(report, validation);
  const idempotencyKey = deliveryIdempotencyKey(report);
  const attemptCount = (previousFailure?.attemptCount ?? 0) + 1;
  try { await writeFile(claimPath, json({ status: "CLAIMED", reportId: report.reportId, checksum: report.checksum, idempotencyKey, attemptCount, claimedAt: now().toISOString() }), { flag: "wx" }); }
  catch (error) { if (error.code === "EEXIST") throw new DeliveryError("DELIVERY_IN_PROGRESS_OR_ALREADY_ATTEMPTED"); throw error; }
  const alert = async (record) => { await writeFile(path.join(dir, "owner-alert.json"), json({ alertKey: `${report.reportId}/${record.status}`, ...record }), { flag: "wx" }).catch((error) => { if (error.code !== "EEXIST") throw error; }); };
  const uncertain = async (reason) => {
    const record = { status: "DELIVERY_OUTCOME_UNCERTAIN", reportId: report.reportId, checksum: report.checksum, failedAt: now().toISOString(), idempotencyKey, reason, ownerAction: "Inspect the provider before retrying; do not delete the claim automatically." };
    await writeFile(uncertainPath, json(record), { flag: "wx" }).catch((error) => { if (error.code !== "EEXIST") throw error; });
    await alert(record);
    throw new DeliveryError("EMAIL_PROVIDER_OUTCOME_UNCERTAIN", record);
  };
  let response;
  try {
    response = await fetchImpl("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ from: env.DELIVERY_FROM_EMAIL, to: [report.customer.deliveryEmail], subject: `Your Local Opportunity Brief — week of ${report.weekOf}`, text: markdown }), signal: AbortSignal.timeout(30_000) });
  } catch { return await uncertain("Network request failed; provider acceptance is unknown."); }
  if (response.status >= 500 || response.status === 408 || response.status === 409) return await uncertain(`Provider returned ambiguous HTTP ${response.status}.`);
  if (!response.ok) {
    const retryable = response.status === 429;
    const retrySeconds = Math.max(60, Math.min(86_400, Number(response.headers.get("retry-after")) || 60));
    const failure = { status: "DELIVERY_FAILED", reportId: report.reportId, failedAt: now().toISOString(), idempotencyKey, provider: "resend", providerStatus: response.status, retryable, attemptCount, retryAfter: new Date(now().valueOf() + retrySeconds * 1000).toISOString() };
    await writeFile(failurePath, json(failure));
    if ([400, 422].includes(response.status)) await writeFile(path.join(dir, "recipient-suppression.json"), json({ reason: "PROVIDER_REJECTED_RECIPIENT_OR_CONTENT", reportId: report.reportId, suppressedAt: now().toISOString() }));
    await alert(failure);
    await unlink(claimPath);
    throw new DeliveryError(`EMAIL_PROVIDER_FAILED_${response.status}`, failure);
  }
  let providerResult;
  try { providerResult = await response.json(); } catch { return await uncertain("Provider response could not be parsed."); }
  if (typeof providerResult?.id !== "string" || !providerResult.id) return await uncertain("Provider did not return a message ID.");
  const receipt = { status: "ACCEPTED", reportId: report.reportId, checksum: report.checksum, acceptedAt: now().toISOString(), provider: "resend", providerMessageId: providerResult.id, idempotencyKey };
  try { await writeFile(receiptPath, json(receipt), { flag: "wx" }); } catch { return await uncertain("Provider accepted the send but the receipt could not be persisted."); }
  await unlink(claimPath).catch(() => {});
  return receipt;
}
