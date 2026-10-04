import { validateReport, MAX_SOURCE_AGE_DAYS } from "../automation/lib/engine.mjs";
const LOOKAHEAD_DAYS = 30;

export async function validateReportSyncPayload(payload) {
  const errors = [];
  const report = payload?.report;
  const validation = payload?.validation;

  if (payload?.schemaVersion !== 1) errors.push("Unsupported sync schema.");
  if (!report || typeof report !== "object") errors.push("Report is missing.");
  if (!validation || typeof validation !== "object") errors.push("Validation is missing.");
  if (errors.length > 0) return { passed: false, errors };
  if(!Array.isArray(report.opportunities)||report.opportunities.some(o=>!o||typeof o!=="object"||Array.isArray(o)||!o.evidence||typeof o.evidence!=="object")) return {passed:false,errors:["Malformed opportunities."]};
  try { const checked=validateReport(report); errors.push(...checked.errors); } catch { return {passed:false,errors:["Malformed report."]}; }

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

  {
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


export async function validateCurrentReportPacket(payload, now = new Date()) {
 const base=await validateReportSyncPayload(payload);
 const errors=[...base.errors];
 if(!base.passed) return base;
 const r=payload?.report;
 if (!r) return {passed:false,errors};
 const asOf=Date.parse(`${r.asOf}T00:00:00Z`);
 const age=(now.getTime()-asOf)/86400000;
 if (!Number.isFinite(asOf)||age<0||age>7) errors.push('Report is not current.');
 const seen=new Set();
 for (const o of r.opportunities??[]) {
   if (!o?.id||seen.has(o.id)) errors.push('Duplicate opportunity.'); seen.add(o?.id);
   const date=Date.parse(`${o.eventDate}T23:59:59Z`);
   if (!Number.isFinite(date)||date<now.getTime()||date>asOf+31*86400000) errors.push('Event outside current window.');
   const source=o.evidence??o;
   const url=source.sourceUrl??o.sourceUrl;
   const checked=Date.parse(`${source.checkedAt}T00:00:00Z`);
   if (!Number.isFinite(checked)||now.getTime()-checked>=MAX_SOURCE_AGE_DAYS*86400000||checked>now.getTime()) errors.push("Source freshness invalid.");
   if (source.accessStatus!=="verified") errors.push("Source access unverified.");
   if (!["official-government","official-school","official-organizer","official-destination-office","customer-first-party"].includes(source.authority)) errors.push("Source authority invalid.");
   try { if(new URL(url).protocol!=='https:') throw new Error(); } catch { errors.push('Invalid source URL.'); }
 }
 return {passed:errors.length===0,errors};
}
