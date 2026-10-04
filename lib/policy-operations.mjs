/**
 * Read-only owner-review planning. This module does not authorize a refund,
 * establish a customer promise, verify identity, or delete/modify a record.
 * Only use verified source records; missing anchors stay visible for review.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function instant(value, field) {
  // Reject local-time/date-only strings and JavaScript's silent date rollover.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new TypeError(`${field} must be a canonical UTC timestamp.`);
  }
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) {
    throw new TypeError(`${field} must be a valid UTC timestamp.`);
  }
  return result;
}

function optionalInstant(value, field) {
  return value == null ? null : instant(value, field);
}

function checkedId(value, field = 'id') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(value)) {
    throw new TypeError(`${field} is invalid.`);
  }
  return value;
}

function timestamp(value) {
  return new Date(value).toISOString();
}

function addUtcMonths(value, months) {
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const monthEnd = new Date(result);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  monthEnd.setUTCDate(0);
  const last = monthEnd.getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result.getTime();
}

/** Validate an explicitly agreed Monday deadline; never infer one from intake. */
export function firstBriefAnchor(schedule) {
  if (!schedule) return null;
  const due = instant(schedule.dueAt, 'dueAt');
  if (typeof schedule.timeZone !== 'string' || !schedule.timeZone) throw new TypeError('timeZone is required.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: schedule.timeZone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(due);
  const local = Object.fromEntries(parts.map(part => [part.type, part.value]));
  if (local.weekday !== 'Monday' || schedule.scheduledMonday !== `${local.year}-${local.month}-${local.day}`) {
    throw new TypeError('The deadline must be on the recorded Monday in its stated time zone.');
  }
  if (typeof schedule.evidenceReference !== 'string' || !schedule.evidenceReference.trim()) {
    throw new TypeError('A customer-visible scheduling evidence reference is required.');
  }
  return {
    scheduledMonday: schedule.scheduledMonday,
    dueAt: schedule.dueAt,
    timeZone: schedule.timeZone,
    lateRequestThresholdAt: timestamp(due + 7 * DAY_MS),
  };
}

/** Assess timing only. Even a passing timing finding is never a refund approval. */
export function planRefundRequest(request, asOf) {
  const now = instant(asOf, 'asOf');
  const requested = instant(request.requestedAt, 'requestedAt');
  if (requested > now) throw new TypeError('A refund request cannot be in the future.');
  const result = {
    id: checkedId(request.id), customerId: checkedId(request.customerId, 'customerId'),
    requestedAt: request.requestedAt, kind: request.kind,
    reviewRequired: true, executeRefund: false,
    timingFinding: 'manual_review', thresholdAt: null,
  };
  if (request.kind === 'first_brief_late') {
    const anchor = firstBriefAnchor(request.firstBriefSchedule);
    if (!anchor) return { ...result, timingFinding: 'missing_first_brief_anchor' };
    const delivered = optionalInstant(request.firstDeliveredAt, 'firstDeliveredAt');
    if (delivered !== null && delivered > now) throw new TypeError('Delivery evidence cannot be in the future.');
    // Evaluate lateness when the claim was filed, capped by actual delivery.
    const end = delivered === null ? requested : Math.min(requested, delivered);
    return {
      ...result, thresholdAt: anchor.lateRequestThresholdAt,
      timingFinding: end > Date.parse(anchor.lateRequestThresholdAt)
        ? 'more_than_seven_days_late' : 'seven_day_lateness_threshold_not_exceeded',
    };
  }
  if (request.kind === 'material_factual_error') {
    const delivered = optionalInstant(request.reportDeliveredAt, 'reportDeliveredAt');
    if (delivered === null) return { ...result, timingFinding: 'missing_verified_delivery' };
    if (delivered > now) throw new TypeError('Delivery evidence cannot be in the future.');
    const threshold = delivered + 7 * DAY_MS;
    return {
      ...result, thresholdAt: timestamp(threshold),
      timingFinding: requested < delivered ? 'request_precedes_delivery'
        : requested <= threshold ? 'within_seven_days_of_delivery' : 'outside_seven_day_error_window',
    };
  }
  if (request.kind !== 'other_or_statutory') throw new TypeError('Unknown refund request kind.');
  return result;
}

/**
 * Policy maximums create a review deadline, not automatic deletion permission.
 * UTC calendar-month arithmetic clamps leap days; day intervals are 24 hours.
 */
export function planRetentionRecord(record, asOf) {
  const now = instant(asOf, 'asOf');
  const result = {
    id: checkedId(record.id), category: record.category,
    status: 'missing_anchor', anchorAt: null, reviewBy: null,
    reviewRequired: true, executeDeletion: false,
  };
  let anchor, deadline;
  switch (record.category) {
    case 'unaccepted_request':
      anchor = optionalInstant(record.finalDecisionAt, 'finalDecisionAt');
      if (anchor !== null) deadline = anchor + 90 * DAY_MS;
      break;
    case 'customer_profile':
    case 'weekly_report':
      if (record.serviceActive === true) {
        if (record.cancellationRecordedAt != null) throw new TypeError('Active service conflicts with a cancellation anchor.');
        return { ...result, status: 'retain_while_active' };
      }
      anchor = optionalInstant(record.cancellationRecordedAt, 'cancellationRecordedAt');
      if (anchor !== null) deadline = addUtcMonths(anchor, 12);
      break;
    case 'delivery_receipt':
    case 'payment_event':
      anchor = optionalInstant(record.recordedAt, 'recordedAt');
      if (anchor !== null) deadline = addUtcMonths(anchor, 24);
      break;
    case 'delivery_diagnostic':
      if (record.resolutionStatus === 'unresolved') {
        if (record.resolvedAt != null) throw new TypeError('Unresolved diagnostics cannot have a resolution anchor.');
        return { ...result, status: 'retain_until_resolved' };
      }
      if (record.resolutionStatus !== 'resolved') throw new TypeError('Diagnostic resolution status is required.');
      anchor = optionalInstant(record.resolvedAt, 'resolvedAt');
      if (anchor !== null) deadline = anchor + 90 * DAY_MS;
      break;
    case 'pilot_packet':
      return { ...result, status: 'manual_need_review' };
    default:
      throw new TypeError('Unknown retention category.');
  }
  if (anchor === null) return result;
  if (anchor > now) throw new TypeError('Retention evidence cannot be in the future.');
  return {
    ...result, anchorAt: timestamp(anchor), reviewBy: timestamp(deadline),
    status: record.hold === true ? 'hold_review_required'
      : deadline <= now ? 'due_for_review' : 'scheduled_review',
  };
}

/** Combine safe, minimal metadata for an owner queue without mutating inputs. */
export function buildPolicyReviewQueue({ refundRequests = [], retentionRecords = [] }, asOf) {
  instant(asOf, 'asOf');
  const seen = new Set();
  const deduplicate = (kind, input) => {
    const key = `${kind}:${input.id}`;
    if (seen.has(key)) throw new TypeError(`Duplicate ${kind} id.`);
    seen.add(key);
  };
  const refunds = refundRequests.map(request => {
    deduplicate('refund', request);
    return planRefundRequest(request, asOf);
  }).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id));
  const retention = retentionRecords.map(record => {
    deduplicate(`retention:${record.category}`, record);
    return planRetentionRecord(record, asOf);
  }).sort((a, b) => (a.reviewBy ?? '').localeCompare(b.reviewBy ?? '') || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
  return { asOf, mode: 'owner_review_only', refunds, retention };
}
