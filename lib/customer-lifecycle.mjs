export function marketId(profile) {
  return `${profile.state}-${profile.city}-${profile.zip}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
export function customerDeliveryGate(customer, {marketApproved = false, reportApproved = false, reportValid = false} = {}) {
  const errors = [];
  if (customer?.status !== 'active') errors.push('CUSTOMER_NOT_ACTIVE');
  if (customer?.payment_status !== 'active') errors.push('SUBSCRIPTION_NOT_ACTIVE');
  if (customer?.onboarding_status !== 'complete') errors.push('INTAKE_INCOMPLETE');
  if (customer?.delivery_status === 'suppressed') errors.push('RECIPIENT_SUPPRESSED');
  let profile;
  try { profile = typeof customer?.profile_json === 'string' ? JSON.parse(customer.profile_json) : customer?.profile; } catch { profile = null; }
  if (profile?.isTest) errors.push('QA_CUSTOMER_NOT_DELIVERABLE');
  if (profile?.deliveryConsent !== true) errors.push('DELIVERY_CONSENT_REQUIRED');
  if (!reportValid) errors.push('REPORT_INVALID');
  const reviewRequired = !customer?.first_delivered_at || !marketApproved || customer?.require_every_review !== 0;
  if (reviewRequired && !reportApproved) errors.push('OWNER_REVIEW_REQUIRED');
  return {allowed: errors.length === 0, reviewRequired, errors};
}
export function paymentTransition(previous, event) {
  if (!event || !['active','past_due','canceled','expired','unpaid'].includes(event.status)) throw new Error('Invalid payment status');
  if (!event.occurredAt || !Number.isFinite(Date.parse(event.occurredAt))) throw new Error('Invalid event date');
  if (previous?.payment_updated_at && Date.parse(event.occurredAt) <= Date.parse(previous.payment_updated_at)) return {apply:false,reason:'STALE_OR_DUPLICATE'};
  return {apply:true, payment_status:event.status, payment_updated_at:event.occurredAt,
    status: ['paused','canceled'].includes(previous?.status) ? previous.status : event.status === 'active' ? (previous?.onboarding_status === 'complete' ? 'active' : 'onboarding') : 'blocked'};
}
