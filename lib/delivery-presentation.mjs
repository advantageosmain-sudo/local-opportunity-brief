import { renderMarkdown } from '../automation/lib/engine.mjs';

// A delivery envelope is a view of immutable research plus separate authorization.
// It never changes the report, checksum, owner decision or provider receipt.
/**
 * @param {*} report
 * @param {*} validation
 * @param {{decision?: Record<string, unknown> | null, policyAuthorized?: boolean, preparedAt?: string}} [options]
 */
export function renderDeliveryMarkdown(report, validation, {
  decision = null,
  policyAuthorized = false,
  preparedAt = new Date().toISOString(),
} = {}) {
  const prepared = Date.parse(preparedAt);
  const generated = Date.parse(report?.generatedAt);
  if (!Number.isFinite(prepared) || !Number.isFinite(generated) || generated > prepared
    || validation?.passed !== true || !['owner_review_only', 'customer'].includes(report?.customer?.deliveryMode)) {
    throw new Error('Delivery presentation requires valid snapshot and preparation context.');
  }
  const exactApproval = decision?.decision === 'approve'
    && decision.report_id === report.reportId && decision.checksum === report.checksum;
  if (decision && !exactApproval) throw new Error('Delivery presentation requires an exact matching approval.');
  if (!exactApproval && !(policyAuthorized === true && report.customer.deliveryMode === 'customer')) {
    throw new Error('Delivery presentation requires approved owner review or an authorized customer policy.');
  }
  let reviewSummary;
  if (exactApproval) {
    const approved = typeof decision.decided_at === 'string' ? Date.parse(decision.decided_at) : NaN;
    if (!Number.isFinite(approved) || approved > prepared) throw new Error('Owner approval timestamp is invalid.');
    reviewSummary = `Exact owner approval recorded ${new Date(approved).toISOString()}.`;
  } else {
    reviewSummary = 'Released under the saved customer review policy; no new exact owner approval is claimed.';
  }
  return renderMarkdown(report, validation, {
    deliveryPresentation: { preparedAt: new Date(prepared).toISOString(), reviewSummary },
  });
}
