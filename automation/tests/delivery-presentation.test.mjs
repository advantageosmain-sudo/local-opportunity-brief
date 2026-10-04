import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderMarkdown, computeReportChecksum } from '../lib/engine.mjs';
import { renderDeliveryMarkdown } from '../../lib/delivery-presentation.mjs';

const root = new URL('../../evidence/owner-test-olympia-future-2026-10-03/', import.meta.url);
const packet = JSON.parse(await readFile(new URL('dashboard-sync.json', root), 'utf8'));
const frozenMarkdown = await readFile(new URL('report.md', root), 'utf8');
const checksum = '0d1635457fbe814edbf4e374edffe7978a1629a968fdaedd31929889b923a408';
const decision = { report_id: packet.report.reportId, checksum, decision: 'approve', decided_at: '2026-10-03T14:41:14.253Z', actor_email: 'PRIVATE_ACTOR@example.com', notes: 'PRIVATE_APPROVAL_NOTES' };
const preparedAt = '2026-10-03T23:47:00.000Z';

function frozen(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) frozen(child); } return value; }

test('legacy frozen Markdown and report checksum remain byte-for-byte unchanged', () => {
  assert.equal(renderMarkdown(packet.report, packet.validation), frozenMarkdown);
  assert.equal(computeReportChecksum(packet.report), checksum);
  assert.equal(packet.report.status, 'PENDING_APPROVAL');
});

test('delivery view joins exact owner decision without mutating frozen report or implying provider delivery', () => {
  const original = JSON.stringify(packet); const input = frozen(structuredClone(packet)); const approval = frozen(structuredClone(decision));
  const text = renderDeliveryMarkdown(input.report, input.validation, { decision: approval, preparedAt });
  assert.match(text, /\*\*Review:\*\* Exact owner approval recorded 2026-10-03T14:41:14.253Z\./);
  assert.match(text, /\*\*Email prepared:\*\* 2026-10-03T23:47:00.000Z/);
  assert.match(text, /\*\*Report content checksum:\*\* `0d1635457fbe814edbf4e374edffe7978a1629a968fdaedd31929889b923a408`/);
  assert.match(text, /Owner-only rehearsal; no customer delivery is authorized/);
  assert.doesNotMatch(text, /\*\*Status:\*\* PENDING_APPROVAL|Live delivery remains disabled until owner approval|PRIVATE_ACTOR|PRIVATE_APPROVAL_NOTES|\*\*Delivery status:\*\*|\*\*Sent:/);
  assert.doesNotMatch(text.split("## This week's direction")[0], /DELIVERED|ACCEPTED|delivered|receipt|sent/i);
  assert.equal(JSON.stringify(input), original); assert.equal(computeReportChecksum(input.report), checksum);
  assert.equal(renderMarkdown(packet.report, packet.validation), frozenMarkdown);
});

for (const [label, supplied] of [
  ['missing', null], ['wrong report', { ...decision, report_id: 'other-report' }],
  ['wrong checksum', { ...decision, checksum: '0'.repeat(64) }],
  ['revised', { ...decision, decision: 'revise' }], ['reopened', { ...decision, decision: 'reopen' }],
]) test('owner view never claims approval from ' + label + ' decision', () => {
  assert.throws(() => renderDeliveryMarkdown(packet.report, packet.validation, { decision: supplied, policyAuthorized: true, preparedAt }));
});

test('changing snapshot status alone never establishes owner approval', () => {
  const report = structuredClone(packet.report); report.status = 'OWNER_APPROVED';
  assert.throws(() => renderDeliveryMarkdown(report, packet.validation, { preparedAt }));
});

test('customer progressive policy is explicit and never described as a new exact owner decision', () => {
  const report = structuredClone(packet.report); report.customer.deliveryMode = 'customer'; report.deliveryEligible = true; report.checksum = computeReportChecksum(report);
  assert.throws(() => renderDeliveryMarkdown(report, packet.validation, { preparedAt }));
  const text = renderDeliveryMarkdown(report, packet.validation, { policyAuthorized: true, preparedAt });
  assert.match(text, /Released under the saved customer review policy; no new exact owner approval is claimed/);
  assert.doesNotMatch(text, /Exact owner approval recorded|PENDING_APPROVAL|Owner-only rehearsal/);
  assert.match(text, /Future deliveries remain subject to subscription, consent and review controls/);
  assert.throws(() => renderDeliveryMarkdown(report, packet.validation, { decision, policyAuthorized: true, preparedAt }), /matching approval/);
});

test('new email preparation time does not refresh source-check dates or immutable generation time', () => {
  const text = renderDeliveryMarkdown(packet.report, packet.validation, { decision, preparedAt: '2026-10-04T12:00:00.000Z' });
  assert.match(text, /\*\*Email prepared:\*\* 2026-10-04T12:00:00.000Z/);
  assert.ok(text.includes('**Snapshot generated:** ' + packet.report.generatedAt));
  assert.match(text, /\*\*Source snapshot date:\*\* 2026-10-03/);
  assert.equal((text.match(/· checked 2026-10-03 ·/g) ?? []).length, 5);
  assert.doesNotMatch(text, /· checked 2026-10-04 ·/);
  assert.equal(computeReportChecksum(packet.report), checksum);
});

test('invalid or future approval/preparation timestamps fail rather than inventing chronology', () => {
  for (const time of ['invalid', '2026-10-03T01:00:00Z']) assert.throws(() => renderDeliveryMarkdown(packet.report, packet.validation, { decision, preparedAt: time }));
  for (const time of ['invalid', '2026-10-04T01:00:00Z']) assert.throws(() => renderDeliveryMarkdown(packet.report, packet.validation, { decision: { ...decision, decided_at: time }, preparedAt }));
  assert.throws(() => renderDeliveryMarkdown(packet.report, { ...packet.validation, passed: false }, { decision, preparedAt }));
});
