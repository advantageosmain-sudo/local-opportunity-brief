const LOOKAHEAD_DAYS = 30;

export async function validateReportSyncPayload(payload) {
  const errors = [];
  const report = payload?.report;
  const validation = payload?.validation;

  if (payload?.schemaVersion !== 1) errors.push("Unsupported sync schema.");
  if (!report || typeof report !== "object") errors.push("Report is missing.");
  if (!validation || typeof validation !== "object") errors.push("Validation is missing.");
  if (errors.length > 0) return { passed: false, errors };

  if (!/^[a-z0-9-]+-\d{4}-\d{2}-\d{2}$/.test(report.reportId ?? "")) {
    errors.push("Report ID is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(report.checksum ?? "")) {
    errors.push("Report checksum is invalid.");
  }
  if (report.status !== "PENDING_APPROVAL") {
    errors.push("Only owner-pending reports can be synchronized.");
  }
  if (report.lookaheadDays !== LOOKAHEAD_DAYS) {
    errors.push("Report does not use the promised 30-day window.");
  }
  if (!Array.isArray(report.opportunities) || report.opportunities.length !== 5) {
    errors.push("A synchronized report must contain five opportunities.");
  }
  if (report.safeguards?.liveDelivery !== false) {
    errors.push("Synchronized report must keep live delivery disabled.");
  }
  if (validation.passed !== true || (validation.errors?.length ?? 0) !== 0) {
    errors.push("Only passing validation packets can be synchronized.");
  }
  if (!report.customer?.slug || !report.customer?.businessName || !report.weekOf) {
    errors.push("Report customer identity or week is missing.");
  }
  if (payload.deliveryReceipt) {
    if (
      payload.deliveryReceipt.status !== "DELIVERED" ||
      payload.deliveryReceipt.reportId !== report.reportId
    ) {
      errors.push("Delivery receipt does not match this report.");
    }
  }

  if (errors.length === 0) {
    const actualChecksum = await computeReportChecksum(report);
    if (actualChecksum !== report.checksum) errors.push("Report checksum does not match.");
  }
  return { passed: errors.length === 0, errors };
}

export async function computeReportChecksum(report) {
  const payload = { ...report };
  delete payload.checksum;
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
