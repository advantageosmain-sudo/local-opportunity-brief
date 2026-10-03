# One-time rejected sandbox checkout recovery

This recovery is restricted to the reviewed October 2, 2026 owner QA attempt
`71bb3487-c303-4a48-bc7f-9ea91a2f6488`. Stripe request
`req_QmXs0F8hnYQVUU` at `2026-10-02T20:27:59Z` returned HTTP 403,
`more_permissions_required`, for missing Checkout Sessions Write. The caller
cannot select another attempt or supply replacement provider evidence.

The owner QA page has a separate recovery button. It never creates or retries
Checkout. Its POST requires the signed-in owner and the exact canonical Origin.
Only test mode with live delivery off is accepted. The same restricted Stripe
client retrieves the pinned sandbox Price and fully paginates Checkout Sessions.
Any matching session, unreadable provider result, partial pagination, or
ambiguous state blocks recovery. No new API scope is requested.

Under the existing per-customer checkout lease, the endpoint verifies the exact
request SHA-256, original expiry, creating state, null Session, unpaid QA
customer, and reserved founding place. A transactional batch archives the full
original row, customer/reservation snapshots and provider evidence in
`audit_events`, then retires only that exact row. Every original field and lease
is guarded again inside the transaction. A missed guard aborts the whole batch.
The customer and founding reservation are not changed or released. No schema
migration, runtime setting, key, provider object, or sharing change is involved.

The archive ID is `stripe-checkout-recovery-71bb3487-c303-4a48-bc7f-9ea91a2f6488`.
It retains the byte-exact request JSON and all original checkout columns for an
explicitly approved restoration if needed. The archive must remain in place.
A repeat returns `already_recovered` only with a complete, internally consistent
version 2 archive: pinned creating/session-null attempt and request bytes,
original unpaid QA/customer/reservation snapshots, the recorded 403 evidence,
and a complete zero-match session scan. Version 2 adds `snapshotSha256` when the
original retirement transaction is prepared. The digest covers every field in
all three snapshots, including the exact `profile_json` and `request_json`
strings. The canonical UTF-8 JSON envelope has keys `attempt`, `customerBefore`,
and `reservationBefore` in that order; each row's keys are lexicographically
sorted. Replay requires the exact snapshot field sets and database value types.
This checksum detects full-snapshot inconsistency. It is not tamper-proof
authenticity against someone able to rewrite both the snapshots and the digest.

Legacy version 1 archives have no complete snapshot checksum. Replaying one
returns HTTP 409 with an explicit integrity-unverified/review-needed message;
it does not claim `already_recovered`, backfill a checksum, or rewrite the archive.
The historical recovery remains completed and its retained records stay intact.
An original snapshot's historical integrity cannot be established by hashing
the archive now or comparing it with later customer/reservation state.

Replay validates archived snapshots rather than current customer state, so later
legitimate billing or profile changes do not invalidate a version 2 archive.
It never removes a newer attempt. A restored original attempt stops for review.
No archive/schema migration or runtime setting change is included.

After the recovery is verified and the owner confirms the key permission was
saved, the separately authorized QA checkout action can create a fresh attempt
for the same customer. It revalidates the price and retains the same founding
place. Completing a sandbox payment is a separate step; no live payment or
email gate is opened by recovery.

Existing generic expired or uncertain creates continue to stop for owner
reconciliation. This endpoint is not an automatic retry mechanism or a general
database administration feature.

References: [Stripe error handling](https://docs.stripe.com/error-low-level),
[Checkout Session listing](https://docs.stripe.com/api/checkout/sessions/list).
