import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFrozenOwnerPacket, syncFrozenOwnerPacket } from '../sync-frozen-owner-test.mjs';

// Frozen real research is read locally only; transport boundaries are synthetic.
const reportId = 'owner-test-olympia-future-2026-10-03';
const checksum = '0d1635457fbe814edbf4e374edffe7978a1629a968fdaedd31929889b923a408';
const original = JSON.parse(await readFile(new URL('../../evidence/' + reportId + '/dashboard-sync.json', import.meta.url), 'utf8'));
const now = new Date('2026-10-03T14:00:00Z');
const env = { REPORT_SYNC_URL: 'https://unit.example/api/internal/reports', REPORT_SYNC_SECRET: 'SYNTHETIC_SECRET' };
const recipient = 'owner@example.com';
const receiptReply = (changes = {}) => ({ checked: 1, confirmed: 0, failed: 0, reportId, checksum, deliveryStatus: 'accepted', receiptEvent: 'sent', ...changes });
const rehash = packet => { const report = { ...packet.report }; delete report.checksum; packet.report.checksum = createHash('sha256').update(JSON.stringify(report)).digest('hex'); return packet.report.checksum; };
async function setup(t, packet = structuredClone(original)) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lob-owner-sync-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'evidence', reportId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'dashboard-sync.json');
  await writeFile(file, JSON.stringify(packet, null, 2) + '\n');
  return { root, dir, file, packet, input: { root, reportId, expectedChecksum: packet.report.checksum, now } };
}
const rejectionWithoutNetwork = async (input, pattern) => {
  let calls = 0;
  await assert.rejects(syncFrozenOwnerPacket({ ...input, env: input.env ?? env, fetchImpl: async () => { calls++; throw Error('Unexpected transport'); } }), pattern);
  assert.equal(calls, 0);
};

test('exact pinned committed owner packet validates and syncs the exact read bytes once', async t => {
  const s = await setup(t); assert.equal(s.packet.report.checksum, checksum);
  const raw = await readFile(s.file, 'utf8'); const validated = await readFrozenOwnerPacket(s.input);
  assert.equal(validated.raw, raw); let calls = 0;
  const result = await syncFrozenOwnerPacket({ ...s.input, env, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, env.REPORT_SYNC_URL); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.body, raw); assert.equal(options.headers.authorization, 'Bearer SYNTHETIC_SECRET'); assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ status: 'SAVED', reportId }, { status: 201 });
  } });
  assert.equal(calls, 1); assert.deepEqual(result, { status: 'SAVED', reportId, checksum, deliveryRequested: false });
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET|owner@example|opportunities/);
});

test('already-saved identity is accepted without a follow-on action', async t => {
  const s = await setup(t); let calls = 0;
  assert.equal((await syncFrozenOwnerPacket({ ...s.input, env, fetchImpl: async () => { calls++; return Response.json({ status: 'ALREADY_SAVED', reportId }); } })).status, 'ALREADY_SAVED');
  assert.equal(calls, 1);
});

for (const id of ['', '../owner-test-a-2026-10-03', 'owner-test-a/2026-10-03', 'owner-test-a%2f2026-10-03', 'customer-a-2026-10-03', 'OWNER-test-a-2026-10-03', 'owner-test-a-2026-02-30', 'owner-test-' + 'a'.repeat(160) + '-2026-10-03']) {
  test('unsafe/out-of-scope report ID fails before network: ' + id.slice(0, 60), async t => { const s = await setup(t); await rejectionWithoutNetwork({ ...s.input, reportId: id }); });
}
for (const value of ['', 'a'.repeat(63), 'A'.repeat(64), checksum + '\n', '../' + checksum]) {
  test('invalid checksum input fails before network: ' + value.slice(0, 10), async t => { const s = await setup(t); await rejectionWithoutNetwork({ ...s.input, expectedChecksum: value }); });
}

const unsafeStates = [
  ['report identity', p => p.report.reportId = 'owner-test-other-2026-10-03'],
  ['customer identity', p => p.report.customer.slug = 'owner-test-other'],
  ['as-of identity', p => p.report.asOf = '2026-10-02'],
  ['week identity', p => p.report.weekOf = '2026-10-02'],
  ['decided status', p => p.report.status = 'OWNER_APPROVED'],
  ['fixture', p => p.report.fixture = true],
  ['customer delivery mode', p => p.report.customer.deliveryMode = 'customer'],
  ['delivery eligibility', p => p.report.deliveryEligible = true],
  ['live-delivery safeguard', p => p.report.safeguards.liveDelivery = true],
  ['review safeguard', p => p.report.safeguards.ownerApprovalRequired = false],
  ['forged receipt', p => p.deliveryReceipt = null],
  ['fewer than five', p => p.report.opportunities.pop()],
  ['failed validation', p => p.validation.passed = false],
  ['validation errors', p => p.validation.errors = ['blocked']],
  ['unverified source', p => p.report.opportunities[0].evidence.accessStatus = 'unverified'],
  ['stale source', p => p.report.opportunities[0].evidence.checkedAt = '2026-09-01'],
];
for (const [label, mutate] of unsafeStates) test('rejects ' + label + ' even with a recomputed checksum', async t => {
  const p = structuredClone(original); mutate(p); rehash(p); const s = await setup(t, p); await rejectionWithoutNetwork(s.input);
});

test('content mutation, stale/future report and invalid clock fail closed', async t => {
  const s = await setup(t); const p = structuredClone(original); p.report.summary = 'tampered'; await writeFile(s.file, JSON.stringify(p));
  await rejectionWithoutNetwork(s.input);
  await writeFile(s.file, JSON.stringify(original));
  for (const clock of [new Date('2026-10-10T01:00:00Z'), new Date('2026-10-02T01:00:00Z'), new Date('invalid')]) await rejectionWithoutNetwork({ ...s.input, now: clock });
});

for (const target of ['file', 'report-directory', 'evidence-directory']) test('rejects symlink ' + target, async t => {
  const s = await setup(t); const outside = path.join(s.root, 'outside'); await mkdir(outside);
  const copied = path.join(outside, 'dashboard-sync.json'); await writeFile(copied, JSON.stringify(original));
  if (target === 'file') { await rm(s.file); await symlink(copied, s.file); }
  if (target === 'report-directory') { await rm(s.dir, { recursive: true }); await symlink(outside, s.dir); }
  if (target === 'evidence-directory') { await rm(path.join(s.root, 'evidence'), { recursive: true }); await symlink(outside, path.join(s.root, 'evidence')); }
  await rejectionWithoutNetwork(s.input);
});
for (const contents of ['{bad JSON', 'x'.repeat(500001), Uint8Array.from([0xff, 0xfe])]) test('rejects malformed, oversized or invalid-UTF8 input', async t => {
  const s = await setup(t); await writeFile(s.file, contents); await rejectionWithoutNetwork(s.input);
});

for (const config of [
  {}, { ...env, REPORT_SYNC_SECRET: '' }, { ...env, REPORT_SYNC_URL: 'http://unit.example/api/internal/reports' },
  { ...env, REPORT_SYNC_URL: 'https://u:p@unit.example/api/internal/reports' },
  { ...env, REPORT_SYNC_URL: 'https://unit.example/api/internal/automation/deliver' },
  { ...env, REPORT_SYNC_URL: env.REPORT_SYNC_URL + '?secret=value' },
  { ...env, REPORT_SYNC_URL: env.REPORT_SYNC_URL + '#fragment' },
]) test('requires exact safe existing sync endpoint and secret configuration', async t => { const s = await setup(t); await rejectionWithoutNetwork({ ...s.input, env: config }); });

test('transport, HTTP and unconfirmed identity failures do not retry or leak response bodies', async t => {
  const s = await setup(t);
  for (const behavior of [
    () => { throw Error('SYNTHETIC_SECRET owner@example.com'); },
    () => new Response('SYNTHETIC_SECRET owner@example.com', { status: 502 }),
    () => new Response('SYNTHETIC_SECRET invalid JSON'),
    () => Response.json({ status: 'SAVED', reportId: 'wrong', detail: 'SYNTHETIC_SECRET' }),
    () => Response.json({ status: 'DELIVERED', reportId }),
  ]) {
    let calls = 0;
    await assert.rejects(syncFrozenOwnerPacket({ ...s.input, env, fetchImpl: async () => { calls++; return behavior(); } }), e => { assert.doesNotMatch(e.message, /SYNTHETIC_SECRET|owner@example/); return true; });
    assert.equal(calls, 1);
  }
});

test('explicit owner send posts only exact identity/recipient to existing gated route and reports acceptance only', async t => {
  const s = await setup(t); let calls = 0;
  const result = await syncFrozenOwnerPacket({ ...s.input, env, operation: 'owner_rehearsal_send', expectedRecipient: recipient, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://unit.example/api/internal/automation/deliver');
    assert.deepEqual(JSON.parse(options.body), { reportId, checksum, expectedRecipient: recipient }); assert.equal(options.redirect, 'error');
    return Response.json({ status: 'ACCEPTED', reportId, checksum, ownerTest: true, providerMessageId: 'synthetic-message' });
  } });
  assert.equal(calls, 1); assert.equal(result.status, 'ACCEPTED'); assert.equal(result.ownerTest, true); assert.doesNotMatch(JSON.stringify(result), /DELIVERED|owner@example|SYNTHETIC_SECRET/);
});

for (const operation of ['owner_rehearsal_send', 'owner_rehearsal_reconcile']) test(operation + ' rejects absent or unsafe recipients before network', async t => {
  const s = await setup(t);
  for (const value of [undefined, '', 'two@example.com\nBcc:other@example.com', ' owner@example.com', 'owner@@example.com', '<owner@example.com>', 'owner@example.com\n']) await rejectionWithoutNetwork({ ...s.input, operation, expectedRecipient: value });
});

test('send still rejects stale reports; reconcile preserves exact frozen identity but allows age expiry', async t => {
  const s = await setup(t); const input = { ...s.input, now: new Date('2026-10-20T12:00:00Z'), expectedRecipient: recipient };
  await rejectionWithoutNetwork({ ...input, operation: 'owner_rehearsal_send' });
  let calls = 0;
  const result = await syncFrozenOwnerPacket({ ...input, env, operation: 'owner_rehearsal_reconcile', fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://unit.example/api/internal/automation/reconcile-delivery'); assert.deepEqual(JSON.parse(options.body), { reportId, checksum, expectedRecipient: recipient }); return Response.json(receiptReply());
  } });
  assert.equal(calls, 1); assert.deepEqual(result, { status: 'RECONCILED', reportId, checksum, checked: 1, confirmed: 0, failed: 0, deliveryStatus: 'accepted', receiptEvent: 'sent', deliveryRequested: false });
  await rejectionWithoutNetwork({ ...input, operation: 'owner_rehearsal_reconcile', expectedChecksum: '0'.repeat(64) });
});

test('owner send refuses a foreign hash/customer-mode acceptance and reconciliation refuses empty/broad counters', async t => {
  const s = await setup(t);
  for (const response of [{ status: 'ACCEPTED', reportId, checksum, ownerTest: false, providerMessageId: 'unit' }, { status: 'ACCEPTED', reportId, checksum: '0'.repeat(64), ownerTest: true, providerMessageId: 'unit' }]) await assert.rejects(syncFrozenOwnerPacket({ ...s.input, env, operation: 'owner_rehearsal_send', expectedRecipient: recipient, fetchImpl: async () => Response.json(response) }));
  for (const response of [receiptReply({ checked: 0 }), receiptReply({ checked: 4 }), receiptReply({ confirmed: 1, failed: 1 }), receiptReply({ confirmed: -1 }), receiptReply({ reportId: 'other' }), receiptReply({ checksum: '0'.repeat(64) }), receiptReply({ deliveryStatus: 'unknown' }), receiptReply({ receiptEvent: 'PRIVATE_PROVIDER_BODY' })]) await assert.rejects(syncFrozenOwnerPacket({ ...s.input, env, operation: 'owner_rehearsal_reconcile', expectedRecipient: recipient, fetchImpl: async () => Response.json(response) }));
});

test('unknown operations fail closed and workflow defaults to sync with inputs only in env', async t => {
  const s = await setup(t); await rejectionWithoutNetwork({ ...s.input, operation: 'all-customers' });
  const workflow = await readFile(new URL('../../.github/workflows/sync-owner-test.yml', import.meta.url), 'utf8');
  assert.match(workflow, /default: sync/); assert.match(workflow, /contents: read/); assert.match(workflow, /run: node automation\/sync-frozen-owner-test\.mjs/);
  assert.doesNotMatch(workflow, /run:.*\$\{\{|LIVE_DELIVERY|RESEND_API_KEY|schedule:|2026-10-02/);
});


test('receipt results preserve verified durable delivery or failure even when newly-confirmed count is zero', async t => {
  const s = await setup(t);
  for (const expected of [receiptReply({ deliveryStatus: 'delivered', receiptEvent: 'delivered', confirmed: 0 }), receiptReply({ deliveryStatus: 'failed', receiptEvent: 'bounced', failed: 1 })]) {
    const result = await syncFrozenOwnerPacket({ ...s.input, env, operation: 'owner_rehearsal_reconcile', expectedRecipient: recipient, fetchImpl: async () => Response.json(expected) });
    assert.equal(result.deliveryStatus, expected.deliveryStatus); assert.equal(result.receiptEvent, expected.receiptEvent);
    assert.equal(result.reportId, reportId); assert.equal(result.checksum, checksum); assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET|owner@example/);
  }
});
