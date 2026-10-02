# Founding capacity and configured source onboarding

The founding offer remains $49/month for the first ten paying founders. Paid places are lifetime allocations and are not recycled after cancellation. Unpaid places expire after 30 minutes or a capability-authenticated DELETE to `/api/checkout`. Duplicate requests retain the original expiry. Test and live allocations are separate. A single SQLite conditional write reserves capacity atomically.

A local reservation cannot revoke an already-issued Lemon Squeezy reusable checkout URL. Live checkout therefore additionally requires `PROVIDER_CAPACITY_VERIFIED=1`, alongside existing payment verification. Set that flag only after real-provider checkout expiry, single-use/customer association, and inventory/cap tests prove that an expired or reused checkout cannot charge an eleventh founder. No such provider evidence exists yet; live checkout remains disabled. An unexpected paid webhook without a reservation creates `UNRESERVED_PAYMENT_REVIEW_REQUIRED`; do not hide a received payment or fake a refund.

Configured first-party feed ingestion produces candidate evidence for owner validation. It does not make arbitrary United States locations verified automatically. Sources without usable machine-readable event dates, inaccessible sources, recurrence needing expansion, and ambiguous dates remain explicit diagnostics. First customer and new market reports still require review.

Legacy subscription identities without a paid allocation fail closed before new checkout, including canceled founders. Unexpected or expired-reservation payment diagnostics freeze checkout until reconciled. Payment allocation and webhook evidence commit in the same transaction. These controls do not reverse or refund provider charges.
