// Customer eligibility is checked again against durable billing/intake state at send time.
export function customerEligibility(customer) {
  const reasons = [];
  if (customer?.status !== "active") reasons.push("CUSTOMER_NOT_ACTIVE");
  if (customer?.subscriptionStatus !== "active") reasons.push("SUBSCRIPTION_NOT_ACTIVE");
  if (customer?.paymentStatus !== "active") reasons.push("PAYMENT_NOT_CONFIRMED");
  if (customer?.intakeComplete !== true) reasons.push("INTAKE_INCOMPLETE");
  if (customer?.paused === true) reasons.push("CUSTOMER_PAUSED");
  if (customer?.canceledAt || customer?.cancelledAt) reasons.push("CUSTOMER_CANCELED");
  if (customer?.emailSuppressed === true) reasons.push("EMAIL_SUPPRESSED");
  if (customer?.deliveryMode !== "customer") reasons.push("CUSTOMER_DELIVERY_DISABLED");
  if (!isDeliverableEmail(customer?.deliveryEmail)) reasons.push("INVALID_DELIVERY_EMAIL");
  return { eligible: reasons.length === 0, reasons };
}

export function isDeliverableEmail(value) {
  if (typeof value !== "string" || value.length > 254 || value !== value.trim()) return false;
  const match = value.match(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i);
  if (!match) return false;
  const domain = match[1].toLowerCase();
  return !["example.com", "example.net", "example.org", "localhost"].some((host) => domain === host || domain.endsWith(`.${host}`)) && !/\.(invalid|test|localhost)$/.test(domain);
}

// Only a provider-confirmed delivered report with a human approval counts toward
// initial customer/market review. An API-accepted email is not delivery evidence.
export function reviewRequirement({ customerSlug, marketId, history = [], reviewAllReports = true }) {
  const delivered = history.filter((entry) =>
    entry.ownerApproved === true && entry.approvalActorType === "human" &&
    entry.deliveryStatus === "DELIVERED" && entry.providerMessageId &&
    entry.reportId && entry.checksum && entry.customerSlug && entry.marketId,
  );
  const reasons = [];
  if (reviewAllReports !== false) reasons.push("OWNER_REVIEW_ALL_REPORTS");
  if (!delivered.some((entry) => entry.customerSlug === customerSlug)) reasons.push("FIRST_CUSTOMER_REPORT");
  if (!marketId || !delivered.some((entry) => entry.marketId === marketId)) reasons.push("FIRST_MARKET_REPORT");
  return { ownerApprovalRequired: reasons.length > 0, reasons };
}
