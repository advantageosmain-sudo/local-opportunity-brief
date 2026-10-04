# Least-privilege receipt paths (not activated)

The Site's Resend key can remain send-only. This change does not create a webhook,
generate or save a credential, broaden the key, enable customer delivery, send an
email, or reconcile any historical production message. Both new paths default off.

## Signed provider webhook

POST `/api/webhooks/resend` accepts the following Resend email events only:
`sent`, `scheduled`, `delivery_delayed`, `delivered`, `opened`, `clicked`, `bounced`,
`complained`, `failed`, `suppressed`. Inbound email, domain/contact events and other
event types are acknowledged without processing. No email content triggers actions.

Verification follows the documented Svix standard using native Web Crypto
`crypto.subtle.verify` (HMAC-SHA256) over id.timestamp.raw-body. The endpoint checks
the three `svix-*` headers before parsing JSON, requires a signature timestamp
within five minutes, and accepts at most eight bounded signature candidates for
rotation. Body decoding is strict UTF-8, limited to 32 KiB and five seconds.
Neither route needs or calls a provider API read key.

Identity binds `data.email_id` (not the RFC `data.message_id`) and the sole exact
`data.to` recipient to one existing accepted/delivered/failed attempt. The attempt
must still match its stored report ID/checksum/customer mode, and QA/fixture
reports are excluded. Unknown messages and uncertain sends are never adopted;
unrelated events return 200 ignored. A matching recipient with a locally claimed,
provider-ID-less attempt from the last five minutes returns 409 for a later replay
after acceptance commits; this never adopts a message by recipient alone.
No new report, customer, market or send attempt is created.

The outer event `created_at` controls event ordering. Receipt rank is monotonic:
failure > delivered/opened/clicked > pending. Failure always wins, including a late
failure with an older timestamp; same-rank events use timestamp then event ID.
Pending or late delivery cannot undo a failure. Any later recovery needs a separate
reviewed remediation, not an automatic reset. Existing API polling also cannot
restore a failed attempt to delivered.

The immutable identity/evidence fields in `email_receipt_events` retain provider
ID, recipient, report/hash, event ID/type/time, source, payload SHA-256, arrival
and applied outcome. Bodies, subjects, bounce text and signature secrets are not
saved. `email_receipt_state` selects the current event. D1 batches atomically
record dedupe, ordered state, delivery effects and diagnostics. Failed batches
remain retryable. Exact repeats do not repeat effects; an event ID with different
content is a conflict. All existing send locks remain in place.

Only signed customer-mode delivery can establish first-delivered/market history,
and only for a currently active, paid, onboarded, consenting, unsuppressed non-QA
customer with the matching address. Owner receipts never establish eligibility.
Customer failures suppress future delivery; history is not erased.

## Separate external owner-verified historical evidence

POST `/api/owner/email-receipt` is a distinct, default-off owner action. It uses the
existing dispatch-owned ChatGPT identity, OWNER_EMAIL allowlist and exact
PUBLIC_SITE_URL origin check. Bearer automation access is not owner access.

Required body: reportId, checksum, expectedRecipient, providerMessageId,
receiptEvent=`delivered`, observedAt (ISO timestamp), evidenceChecksum (SHA-256 of
retained provider readback evidence), evidenceReference (the exact
`https://resend.com/emails/{providerMessageId}` dashboard URL), and
confirmation=`record-external-owner-verified-delivery`.

The request must match the current owner-rehearsal identity pins, a durable exact
provider ID/recipient/report checksum and exact owner approval. Only owner-only
reports are eligible. The send switch may remain off. The response/audit source
is `external_owner_verified`, explicitly an authenticated owner's evidence
attestation, not a signed provider webhook or an independent provider API read.
The server does not download the reference or independently prove its content.
The approver must retain and inspect the actual external evidence before approving
this action. A connector observation alone does not authorize recording it.
The evidence hash/reference and actor are preserved; no signed event is fabricated.
This route cannot overwrite a failed send or establish customer eligibility.

## Additive migration and deployment safety

Generated migration `0002_amusing_maelstrom.sql` creates only two new tables and
one index. It neither changes nor backfills existing tables. Keep earlier applied
migrations and metadata unchanged. New tables are migration-owned, not created
by request initialization. A missing migration fails closed with a sanitized 503.
Deploy only after the exact code/migration review and authorization; a failed
publish may still have applied a migration, so check that boundary before retrying.

## Secure setup, each action gated

1. Review and approve the exact patch and additive migration before merge/deploy.
2. Confirm this Site's existing access policy permits Resend to POST to the exact
   HTTPS webhook endpoint. Do not broaden Site access or share a service credential
   as a workaround. If the platform blocks it, stop and choose an approved ingress.
3. Obtain explicit per-action approval to create the exact Resend webhook and its
   persistent signing credential. Explain that selected email-event metadata may
   cover the Resend account beyond this one report even though the application
   only processes exact known attempts. Subscribe only to `email.delivered`,
   `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed`.
   The handler recognizes other supported receipt types defensively, but this
   setup does not request open/click tracking or subscriptions to those events.
4. The owner securely enters the provider-generated signing secret in private
   Site settings as RESEND_WEBHOOK_SECRET. Never place it in chat, code, logs,
   workflow inputs or test fixtures. Credential entry/configuration requires the
   appropriate secure handoff and per-action approval. Keep RESEND_API_KEY send-only.
5. After setup approval, set RESEND_WEBHOOK_ENABLED=1. Keep LIVE_DELIVERY=0,
   OWNER_REHEARSAL_ENABLED=0 and billing/other launch gates unchanged. Verify a
   separately approved signed provider test and exact receipt; offline tests do
   not prove deployed routing or production signing configuration.
6. For the original historical message, do not assume webhook creation backfills
   old events. Official replay support covers existing webhook messages. Instead,
   retain its authorized external provider readback and ask for approval to record
   that exact evidence. Only then temporarily enable OWNER_EXTERNAL_RECEIPT_ENABLED,
   submit the exact owner action, verify its recorded source/status, and disable it.
   This implementation does not perform any of these production actions.

Defaults in `.env.example` are documentation only and contain no secret.

## References

- https://resend.com/docs/webhooks/verify-webhooks-requests
- https://www.svix.com/guides/receiving/receive-webhooks-with-javascript-nodejs/
- https://github.com/svix/svix-webhooks/blob/main/javascript/src/webhook.test.ts
- https://resend.com/docs/webhooks/emails/delivered
- https://resend.com/docs/webhooks/event-types
- https://resend.com/docs/webhooks/retries-and-replays

## Owner UI

When the recording gate is enabled, the owner dashboard links to
`/dashboard/email-receipt`. The page shows the form only for a matching approved
owner-only durable attempt. It displays report/hash/recipient/provider identity,
collects the retained evidence checksum and observed timestamp, and requires an
explicit attestation checkbox. Submission uses the normal same-origin UI; no
credential extraction or arbitrary browser console request is needed. Identity
and eligibility are rechecked at the server, so stale page data cannot authorize
a different receipt. The page and API are unavailable when the gate is off.
