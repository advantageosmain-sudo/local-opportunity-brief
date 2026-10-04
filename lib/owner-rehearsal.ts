// OWNER_EMAIL remains the login identity; the approved recipient is a separate exact pin.
// Pins remain available for read-only receipts after the new-send switch is off.
export function ownerRehearsalIdentityMatches(env: {
  OWNER_EMAIL?: string; OWNER_REHEARSAL_REPORT_ID?: string;
  OWNER_REHEARSAL_CHECKSUM?: string; OWNER_REHEARSAL_RECIPIENT?: string;
}, input: {reportId?: unknown; checksum?: unknown; expectedRecipient?: unknown}) {
  return Boolean(env.OWNER_EMAIL && (env.OWNER_REHEARSAL_RECIPIENT?.length ?? 0) <= 254 && !/[\s<>]/.test(env.OWNER_REHEARSAL_RECIPIENT ?? '') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OWNER_REHEARSAL_RECIPIENT ?? '') &&
    /^[a-z0-9-]{1,160}$/.test(env.OWNER_REHEARSAL_REPORT_ID ?? '') &&
    /^[a-f0-9]{64}$/.test(env.OWNER_REHEARSAL_CHECKSUM ?? '') &&
    input.reportId === env.OWNER_REHEARSAL_REPORT_ID &&
    input.checksum === env.OWNER_REHEARSAL_CHECKSUM &&
    input.expectedRecipient === env.OWNER_REHEARSAL_RECIPIENT);
}
