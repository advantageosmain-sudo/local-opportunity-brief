// Identity and payment markers survive damaged profiles. QA rows must never
// contribute to customer/subscription counts or expose real-customer controls.
export function readCustomerProfile(customer) {
  try {
    const profile = typeof customer?.profile_json === "string"
      ? JSON.parse(customer.profile_json) : customer?.profile;
    return profile && typeof profile === "object" && !Array.isArray(profile) ? profile : null;
  } catch {
    return null;
  }
}

export function isQaCustomer(customer) {
  if (String(customer?.id ?? "").startsWith("qa-") ||
      String(customer?.payment_status ?? "").startsWith("test_")) return true;
  return readCustomerProfile(customer)?.isTest === true;
}

export function isCurrentOwnerReport(report, today = currentReportDateKey()) {
  if (!report || typeof report !== "object") return false;
  if (typeof report.asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(report.asOf)) {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;

  const reportDate = Date.parse(`${report.asOf}T12:00:00Z`);
  const currentDate = Date.parse(`${today}T12:00:00Z`);
  if (!Number.isFinite(reportDate) || !Number.isFinite(currentDate)) return false;

  const age = Math.round((currentDate - reportDate) / 86_400_000);
  const hasUpcomingEvent = Boolean(
    report.opportunities?.some(
      (opportunity) =>
        typeof opportunity?.eventDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(opportunity.eventDate) &&
        opportunity.eventDate >= today,
    ),
  );
  return age >= 0 && age <= 7 && hasUpcomingEvent;
}

export function currentPacificDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// Match validateCurrentReportPacket's UTC research-date clock. The weekly
// Chicago schedule and customer delivery promises are separate concerns.
export function currentReportDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
