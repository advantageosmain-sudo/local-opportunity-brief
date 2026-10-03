// Manual frozen owner operations. Sync is default; explicit sends use only the pinned Site gate.
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCurrentReportPacket, validateReportSyncPayload } from '../lib/report-sync.mjs';

const MAX_PACKET_BYTES = 500_000;
const RECEIPT_EVENTS = new Set(['delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'suppressed', 'queued', 'scheduled', 'sent', 'delivery_delayed', 'canceled']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function readFrozenOwnerPacket({ root = process.cwd(), reportId, expectedChecksum, now = new Date(), requireCurrent = true }) {
  const match = typeof reportId === 'string' && reportId.length <= 160 && reportId.trim() === reportId
    ? /^(owner-test-[a-z0-9]+(?:-[a-z0-9]+)*)-(\d{4}-\d{2}-\d{2})$/.exec(reportId)
    : null;
  if (!match || typeof expectedChecksum !== 'string' || expectedChecksum.length !== 64 || !/^[a-f0-9]{64}$/.test(expectedChecksum)) {
    throw new Error('A valid owner-test report ID and exact lowercase SHA-256 are required.');
  }
  const [, customerSlug, asOf] = match;
  if (!Number.isFinite(Date.parse(asOf + 'T00:00:00Z')) || new Date(asOf + 'T00:00:00Z').toISOString().slice(0, 10) !== asOf) {
    throw new Error('Report ID date is invalid.');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Validation clock is invalid.');

  // Inputs never become a free-form path. Reject symlinks at every evidence path component.
  const evidenceDir = path.resolve(root, 'evidence');
  const reportDir = path.join(evidenceDir, reportId);
  const packetPath = path.join(reportDir, 'dashboard-sync.json');
  for (const directory of [evidenceDir, reportDir]) {
    if (!(await lstat(directory)).isDirectory()) throw new Error('Frozen evidence path must use real directories.');
  }
  const stat = await lstat(packetPath);
  if (!stat.isFile() || stat.size > MAX_PACKET_BYTES) throw new Error('Frozen packet must be a bounded regular file.');
  const bytes = await readFile(packetPath);
  if (bytes.length > MAX_PACKET_BYTES) throw new Error('Frozen packet is too large.');
  let raw, packet;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); packet = JSON.parse(raw); }
  catch { throw new Error('Frozen packet must be valid UTF-8 JSON.'); }
  const report = packet?.report;
  if (!isObject(packet) || !isObject(report) || !isObject(report.customer) || 'deliveryReceipt' in packet
    || report.reportId !== reportId || report.customer.slug !== customerSlug
    || report.asOf !== asOf || report.weekOf !== asOf || report.checksum !== expectedChecksum
    || report.status !== 'PENDING_APPROVAL' || report.fixture !== false
    || report.customer.deliveryMode !== 'owner_review_only' || report.deliveryEligible !== false
    || report.safeguards?.liveDelivery !== false || report.safeguards?.ownerApprovalRequired !== true) {
    throw new Error('Frozen packet identity or owner-only safety state does not match.');
  }
  const checked = requireCurrent ? await validateCurrentReportPacket(packet, now) : await validateReportSyncPayload(packet);
  if (!checked.passed) throw new Error('Frozen packet failed current report validation.');
  return { raw, reportId, checksum: expectedChecksum };
}

export async function syncFrozenOwnerPacket({ env = process.env, fetchImpl = fetch, operation = 'sync', expectedRecipient, ...input }) {
  if (!['sync', 'owner_rehearsal_send', 'owner_rehearsal_reconcile'].includes(operation)) throw new Error('Unsupported frozen owner operation.');
  if (operation !== 'sync' && (typeof expectedRecipient !== 'string' || expectedRecipient.length > 254 || expectedRecipient.trim() !== expectedRecipient
    || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(expectedRecipient))) throw new Error('The exact owner rehearsal recipient is required.');
  const validated = await readFrozenOwnerPacket({ ...input, requireCurrent: operation !== 'owner_rehearsal_reconcile' });
  let endpoint;
  try { endpoint = new URL(env.REPORT_SYNC_URL); } catch { throw new Error('The existing report sync endpoint is required.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname !== '/api/internal/reports' || typeof env.REPORT_SYNC_SECRET !== 'string' || !env.REPORT_SYNC_SECRET) {
    throw new Error('Existing HTTPS report-sync configuration is invalid.');
  }
  // No automatic sync+send chain: owner UI approval must happen between dispatches.
  const target = operation === 'sync' ? endpoint.href : new URL('/api/internal/automation/' +
    (operation === 'owner_rehearsal_send' ? 'deliver' : 'reconcile-delivery'), endpoint.origin).href;
  const body = operation === 'sync' ? validated.raw : JSON.stringify({ reportId: validated.reportId, checksum: validated.checksum, expectedRecipient });
  // One exact request only. The Site enforces its default-off rehearsal gate,
  // pinned identity/recipient, exact owner decision, and durable send claim.
  let response;
  try {
    response = await fetchImpl(target, {
      method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${env.REPORT_SYNC_SECRET}`, 'content-type': 'application/json' },
      body, signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error('Frozen owner operation outcome is unconfirmed. No automatic retry was attempted.'); }
  if (!response.ok) throw new Error(`Frozen owner operation failed (${response.status}).`);
  let result;
  try { result = await response.json(); } catch { throw new Error('Frozen owner operation response is invalid.'); }
  if (operation === 'sync') {
    if (!isObject(result) || !['SAVED', 'ALREADY_SAVED'].includes(result.status) || result.reportId !== validated.reportId) {
      throw new Error('Frozen report sync did not confirm the requested identity.');
    }
    return { status: result.status, reportId: validated.reportId, checksum: validated.checksum, deliveryRequested: false };
  }
  if (operation === 'owner_rehearsal_send') {
    if (!isObject(result) || result.status !== 'ACCEPTED' || result.reportId !== validated.reportId
      || result.checksum !== validated.checksum || result.ownerTest !== true
      || typeof result.providerMessageId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(result.providerMessageId)) {
      throw new Error('Owner send acceptance was not confirmed for the requested identity.');
    }
    // ACCEPTED is not inbox arrival or DELIVERED. Never imply otherwise.
    return { status: 'ACCEPTED', reportId: validated.reportId, checksum: validated.checksum, providerMessageId: result.providerMessageId, ownerTest: true };
  }
  if (!isObject(result) || result.reportId !== validated.reportId || result.checksum !== validated.checksum
    || !['accepted', 'delivered', 'failed'].includes(result.deliveryStatus) || !RECEIPT_EVENTS.has(result.receiptEvent)
    || result.checked !== 1 || !Number.isSafeInteger(result.confirmed) || !Number.isSafeInteger(result.failed)
    || result.confirmed < 0 || result.failed < 0 || result.confirmed + result.failed > 1) {
    throw new Error('Exact owner receipt reconciliation response is invalid.');
  }
  return { status: 'RECONCILED', reportId: validated.reportId, checksum: validated.checksum, checked: 1, confirmed: result.confirmed, failed: result.failed, deliveryStatus: result.deliveryStatus, receiptEvent: result.receiptEvent, deliveryRequested: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await syncFrozenOwnerPacket({ reportId: process.env.OWNER_REPORT_ID, expectedChecksum: process.env.OWNER_REPORT_CHECKSUM, operation: process.env.OWNER_REPORT_OPERATION || 'sync', expectedRecipient: process.env.OWNER_REPORT_RECIPIENT });
    console.log(JSON.stringify(result));
  } catch (error) {
    // Do not print transport bodies, provider errors, secrets, or the report contents.
    console.error(error instanceof Error ? error.message : 'Frozen owner report sync failed.');
    process.exitCode = 1;
  }
}
