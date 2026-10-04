import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { firstBriefAnchor, planRefundRequest, planRetentionRecord, buildPolicyReviewQueue } from '../lib/policy-operations.mjs';

const schedule = {
  scheduledMonday: '2026-10-05', dueAt: '2026-10-05T22:00:00.000Z',
  timeZone: 'America/Chicago', evidenceReference: 'synthetic-owner-approved-schedule',
}; // Explicit test fixture only: 17:00 is not an adopted customer promise.
const late = {
  id: 'request-1', customerId: 'customer-1', kind: 'first_brief_late',
  requestedAt: '2026-10-12T22:00:00.001Z', firstBriefSchedule: schedule,
};
const error = {
  id: 'request-2', customerId: 'customer-1', kind: 'material_factual_error',
  reportDeliveredAt: '2026-10-05T22:00:00.000Z', requestedAt: '2026-10-12T22:00:00.000Z',
};
const asOf = '2026-10-20T00:00:00.000Z';

test('an explicit Monday anchor carries the actual date, timezone and strict seven-day threshold', () => {
  assert.deepEqual(firstBriefAnchor(schedule), {
    scheduledMonday: '2026-10-05', dueAt: schedule.dueAt, timeZone: 'America/Chicago',
    lateRequestThresholdAt: '2026-10-12T22:00:00.000Z',
  });
  assert.equal(firstBriefAnchor(null), null);
});

test('an anchor needs Monday and evidence; timestamps are not inferred from intake or payment', () => {
  for (const change of [
    { scheduledMonday: '2026-10-06' }, { dueAt: '2026-10-06T22:00:00.000Z' },
    { evidenceReference: '' }, { timeZone: '' }, { timeZone: 'Invalid/Zone' },
    { dueAt: '2026-10-05' }, { dueAt: '2026-10-05T22:00:00' },
    { dueAt: '2026-02-30T22:00:00.000Z' },
  ]) assert.throws(() => firstBriefAnchor({ ...schedule, ...change }));
  assert.equal(planRefundRequest({ ...late, firstBriefSchedule: null }, asOf).timingFinding, 'missing_first_brief_anchor');
});

test('a Monday evening deadline can be Tuesday UTC, with DST offsets preserved explicitly', () => {
  assert.equal(firstBriefAnchor({ ...schedule, dueAt: '2026-10-06T04:00:00.000Z' }).scheduledMonday, '2026-10-05');
  assert.equal(firstBriefAnchor({ ...schedule, scheduledMonday: '2026-11-02', dueAt: '2026-11-03T05:00:00.000Z' }).scheduledMonday, '2026-11-02');
});

test('lateness is strictly more than seven days, not at the boundary', () => {
  const boundary = { ...late, requestedAt: '2026-10-12T22:00:00.000Z' };
  assert.equal(planRefundRequest(boundary, asOf).timingFinding, 'seven_day_lateness_threshold_not_exceeded');
  const result = planRefundRequest(late, asOf);
  assert.equal(result.timingFinding, 'more_than_seven_days_late');
  assert.equal(result.executeRefund, false);
  assert.equal(result.reviewRequired, true);
});

test('lateness is capped by actual delivery and evaluated at original request time', () => {
  assert.equal(planRefundRequest({ ...late, firstDeliveredAt: '2026-10-05T22:00:00.000Z' }, asOf).timingFinding, 'seven_day_lateness_threshold_not_exceeded');
  assert.equal(planRefundRequest({ ...late, firstDeliveredAt: '2026-10-12T22:00:00.000Z' }, asOf).timingFinding, 'seven_day_lateness_threshold_not_exceeded');
  assert.equal(planRefundRequest({ ...late, firstDeliveredAt: '2026-10-13T22:00:00.000Z' }, asOf).timingFinding, 'more_than_seven_days_late');
  assert.equal(planRefundRequest({ ...late, requestedAt: '2026-10-06T00:00:00.000Z' }, asOf).timingFinding, 'seven_day_lateness_threshold_not_exceeded');
});

test('factual-error filing window includes exactly seven days and never adjudicates materiality', () => {
  assert.equal(planRefundRequest(error, asOf).timingFinding, 'within_seven_days_of_delivery');
  assert.equal(planRefundRequest({ ...error, requestedAt: '2026-10-12T22:00:00.001Z' }, asOf).timingFinding, 'outside_seven_day_error_window');
  assert.equal(planRefundRequest(error, asOf).reviewRequired, true);
  assert.equal(planRefundRequest(error, asOf).executeRefund, false);
});

test('unverified receipt and unusual chronology stay reviewable', () => {
  assert.equal(planRefundRequest({ ...error, reportDeliveredAt: null }, asOf).timingFinding, 'missing_verified_delivery');
  assert.equal(planRefundRequest({ ...error, requestedAt: '2026-10-04T00:00:00.000Z' }, asOf).timingFinding, 'request_precedes_delivery');
  assert.throws(() => planRefundRequest({ ...error, requestedAt: '2026-10-21T00:00:00.000Z' }, asOf));
  assert.throws(() => planRefundRequest({ ...error, reportDeliveredAt: '2026-10-21T00:00:00.000Z' }, asOf));
});

test('other and statutory grounds have no invented cutoff or automated denial', () => {
  const result = planRefundRequest({ ...error, kind: 'other_or_statutory' }, asOf);
  assert.equal(result.timingFinding, 'manual_review');
  assert.equal(result.thresholdAt, null);
  assert.equal(result.executeRefund, false);
  assert.throws(() => planRefundRequest({ ...error, kind: 'automatic_full_refund' }, asOf));
});

test('unaccepted requests use final decision, never created or updated date', () => {
  const input = { id: 'lead-1', category: 'unaccepted_request', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: asOf };
  assert.equal(planRetentionRecord(input, asOf).status, 'missing_anchor');
  const result = planRetentionRecord({ ...input, finalDecisionAt: '2026-10-01T12:00:00.000Z' }, asOf);
  assert.equal(result.reviewBy, '2026-12-30T12:00:00.000Z');
  assert.equal(result.status, 'scheduled_review');
});

test('retention queues become due at the exact maximum, without authorizing deletion', () => {
  const input = { id: 'lead-1', category: 'unaccepted_request', finalDecisionAt: '2026-10-01T12:00:00.000Z' };
  assert.equal(planRetentionRecord(input, '2026-12-30T11:59:59.999Z').status, 'scheduled_review');
  const result = planRetentionRecord(input, '2026-12-30T12:00:00.000Z');
  assert.equal(result.status, 'due_for_review');
  assert.equal(result.executeDeletion, false);
});

test('active profiles and weekly reports retain service; inactive records need an actual cancellation anchor', () => {
  for (const category of ['customer_profile', 'weekly_report']) {
    const input = { id: 'customer-1', category };
    assert.equal(planRetentionRecord({ ...input, serviceActive: true }, asOf).status, 'retain_while_active');
    assert.equal(planRetentionRecord({ ...input, serviceActive: false }, asOf).status, 'missing_anchor');
    const result = planRetentionRecord({ ...input, serviceActive: false, cancellationRecordedAt: '2026-10-01T12:00:00.000Z' }, asOf);
    assert.equal(result.reviewBy, '2027-10-01T12:00:00.000Z');
    assert.throws(() => planRetentionRecord({ ...input, serviceActive: true, cancellationRecordedAt: '2026-10-01T12:00:00.000Z' }, asOf));
  }
});

test('12 and 24 calendar months clamp leap day instead of overflowing into March', () => {
  assert.equal(planRetentionRecord({ id: 'c-1', category: 'customer_profile', cancellationRecordedAt: '2024-02-29T12:00:00.000Z' }, asOf).reviewBy, '2025-02-28T12:00:00.000Z');
  for (const category of ['payment_event', 'delivery_receipt']) {
    assert.equal(planRetentionRecord({ id: 'event-1', category, recordedAt: '2024-02-29T12:00:00.000Z' }, asOf).reviewBy, '2026-02-28T12:00:00.000Z');
  }
});

test('legal or dispute holds retain the original deadline visibly for owner review', () => {
  const result = planRetentionRecord({ id: 'event-1', category: 'payment_event', recordedAt: '2024-02-29T12:00:00.000Z', hold: true }, asOf);
  assert.equal(result.status, 'hold_review_required');
  assert.equal(result.reviewBy, '2026-02-28T12:00:00.000Z');
  assert.equal(result.executeDeletion, false);
});

test('diagnostic retention starts at resolution, with unresolved and missing timestamps explicit', () => {
  const input = { id: 'diagnostic-1', category: 'delivery_diagnostic' };
  assert.equal(planRetentionRecord({ ...input, resolutionStatus: 'unresolved' }, asOf).status, 'retain_until_resolved');
  assert.equal(planRetentionRecord({ ...input, resolutionStatus: 'resolved' }, asOf).status, 'missing_anchor');
  assert.equal(planRetentionRecord({ ...input, resolutionStatus: 'resolved', resolvedAt: '2026-10-01T12:00:00.000Z' }, asOf).reviewBy, '2026-12-30T12:00:00.000Z');
  assert.throws(() => planRetentionRecord({ ...input, resolutionStatus: 'unresolved', resolvedAt: '2026-10-01T12:00:00.000Z' }, asOf));
  assert.throws(() => planRetentionRecord(input, asOf));
});

test('pilot packets need purpose review instead of an invented deletion clock', () => {
  assert.equal(planRetentionRecord({ id: 'pilot-1', category: 'pilot_packet' }, asOf).status, 'manual_need_review');
});

test('invalid IDs, future anchors and invalid datetimes are rejected', () => {
  assert.throws(() => planRetentionRecord({ id: '<script>', category: 'pilot_packet' }, asOf));
  assert.throws(() => planRetentionRecord({ id: 'x', category: 'other' }, asOf));
  assert.throws(() => planRetentionRecord({ id: 'x', category: 'unaccepted_request', finalDecisionAt: '2026-10-21T00:00:00.000Z' }, asOf));
  assert.throws(() => planRetentionRecord({ id: 'x', category: 'unaccepted_request', finalDecisionAt: '2026-02-30T00:00:00.000Z' }, asOf));
  assert.throws(() => buildPolicyReviewQueue({}, 'not-a-date'));
});

test('queue output is deterministic and does not echo profile, secret, note or payment data', () => {
  const input = {
    refundRequests: [{ ...late, notes: 'private refund narrative', paymentCard: 'NEVER-ECHO' }, { ...error, profile: { checkoutToken: 'NEVER-ECHO' } }],
    retentionRecords: [
      { id: 'lead-2', category: 'unaccepted_request', finalDecisionAt: '2026-10-02T00:00:00.000Z' },
      { id: 'lead-1', category: 'unaccepted_request' },
    ],
  };
  const snapshot = JSON.stringify(input);
  const queue = buildPolicyReviewQueue(input, asOf);
  assert.equal(queue.mode, 'owner_review_only');
  assert.deepEqual(queue.refunds.map(x => x.id), ['request-2', 'request-1']);
  assert.deepEqual(queue.retention.map(x => x.id), ['lead-1', 'lead-2']);
  assert.doesNotMatch(JSON.stringify(queue), /NEVER-ECHO|private refund narrative|checkoutToken/);
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(queue, buildPolicyReviewQueue(input, asOf));
});

test('duplicate queue records fail visibly instead of double-counting', () => {
  assert.throws(() => buildPolicyReviewQueue({ refundRequests: [late, late] }, asOf));
  const record = { id: 'pilot-1', category: 'pilot_packet' };
  assert.throws(() => buildPolicyReviewQueue({ retentionRecords: [record, record] }, asOf));
  assert.equal(buildPolicyReviewQueue({ retentionRecords: [
    { id: 'same-subject', category: 'customer_profile', serviceActive: true },
    { id: 'same-subject', category: 'weekly_report', serviceActive: true },
  ] }, asOf).retention.length, 2);
});

test('planner has no provider, database, credential, network, or deletion execution dependencies', async () => {
  const source = await readFile(new URL('../lib/policy-operations.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\b|\bfetch\s*\(|\bprocess\.env\b|\bDELETE\s+FROM\b|\.refunds\.create\b|\bunlink\b/);
});
