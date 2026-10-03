# Email configuration and verification

This document describes the current hosted delivery path. It supersedes the
Resend placement and owner-pilot delivery instructions in OWNER_TEST_SETUP.md.
No credentials or provider receipts are included here. Default outbound delivery
remains disabled; code tests alone do not authorize or prove live delivery.

## Where configuration belongs

The Site backend owns Resend calls and durable delivery state. GitHub automation
calls the Site; it does not use a Resend key.

Required in the **Site's private server-side runtime settings**:

- DB: the existing application database binding.
- OWNER_EMAIL: the verified owner login email. Keep this unchanged when approving a different rehearsal destination.
- REPORT_SYNC_SECRET: the existing shared automation secret, matching GitHub.
- RESEND_API_KEY: a privately configured provider key. The current implementation
  uses this one key both to send and to retrieve sent-message status.
- DELIVERY_FROM_EMAIL: a provider-permitted sender address.
- LIVE_DELIVERY: keep 0 during the owner-only rehearsal. Customer sends always
  require 1 and a separately approved launch.
- OWNER_REHEARSAL_ENABLED: defaults to 0. An authorized exact owner-only rehearsal
  can set 1 while keeping LIVE_DELIVERY=0.
- OWNER_REHEARSAL_REPORT_ID and OWNER_REHEARSAL_CHECKSUM: pin the exact approved
  report. OWNER_REHEARSAL_RECIPIENT is the separately approved exact email destination. All three pins
  and request expectedRecipient must match; there is no recipient override.

POST /api/internal/automation/deliver with {reportId,checksum,expectedRecipient}
uses this narrow exception only for owner_review_only reports. Current packet
validation, exact owner approval, QA isolation and atomic send deduplication still
apply. Restore OWNER_REHEARSAL_ENABLED=0 after the authorized attempt. Acceptance
is not delivery confirmation and uncertain results must not be automatically retried.

POST /api/internal/automation/reconcile-delivery with the same exact selector
reads only the approved matching owner attempt. Keep the pins for this readback;
it works after the rehearsal switch is off or the report becomes stale. Invalid
or partial selectors fail closed. The existing bodyless/empty-object batch call
is unchanged. Verified owner receipts never establish customer or market delivery
eligibility. No live send or provider receipt is proven by offline tests.

Required in **GitHub Actions** when using the checked-in workflows:

- Secret REPORT_SYNC_SECRET: matches the Site backend.
- Variable REPORT_SYNC_URL: the backend's HTTPS URL ending in
  /api/internal/reports.
- Variable LIVE_DELIVERY: 1 only when the hourly receipt workflow should run;
  otherwise leave 0. This GitHub setting does not enable the Site sender.
- Variable WEEKLY_DELIVERY_ENABLED: leave false/unset for review-only runs.
  Set true only for separately authorized scheduled customer delivery.

A manual weekly run's process_delivery input requests the hosted checks. It does
not bypass report approvals. No current workflow references the historical
outbound-delivery GitHub environment, so creating that environment by itself adds
no approval protection to these workflows.

Do not store RESEND_API_KEY or DELIVERY_FROM_EMAIL in GitHub for this production
path. Never paste secrets into chat, source files, issues, workflow inputs or
artifacts. New credentials or expanded persistent access require owner approval
and secure entry.

## Provider access: sending is different from receipt retrieval

Prefer the existing send-only key for sending. Resend's sending_access permission
cannot perform GET /emails/:id. If an already authorized Resend connector supports
readback, it may independently observe the exact message's receipt without
expanding the Site key. Such an external observation is not runtime reconciliation
and cannot be written into this database through an invented route.

The current single-key runtime reconciliation requires provider read access
(Resend full_access). Do not broaden access merely to finish a rehearsal: any new
or expanded permission needs explicit owner approval and secure configuration.
A send-only key may prove API acceptance, but cannot prove runtime reconciliation.

A narrower future architecture could retain a restricted sending key and use
signed provider webhooks for receipts. That webhook path is not implemented; do
not describe it as available or enable new access silently.

Official references:
- [API key permissions](https://resend.com/docs/api-reference/api-keys/create-api-key)
- [Restricted-key errors](https://resend.com/docs/api-reference/errors)
- [Retrieve a sent email](https://resend.com/docs/api-reference/emails/retrieve-email)

## Three distinct verification levels

### 1. Mocked local safety tests

No provider account or credentials are needed. Tests simulate provider responses,
exact approval gates, durable duplicate-send protection and customer suppression.
They provide no inbox, DNS, provider-account or actual delivery evidence.

### 2. Owner-only provider rehearsal

This is a real provider request and, if addressed to the owner, a real email.

Minimum evidence and prerequisites:
1. Verify the Resend account and the permitted sender. Resend's default
   onboarding@resend.dev sender is restricted to the account's own email address;
   The approved OWNER_REHEARSAL_RECIPIENT must match that permitted recipient, or use an appropriately
   verified sender domain.
2. Use a current source-validated report with deliveryMode owner_review_only.
   Synchronize it to the Site and have the authenticated owner approve its exact
   checksum. A synthetic QA customer record is not a substitute for this packet.
3. Configure the authorized Site values through the secure settings flow. Keep
   LIVE_DELIVERY=0, the existing payment mode, and scheduled customer delivery off.
4. Obtain explicit approval for the exact owner send. Pin OWNER_REHEARSAL_REPORT_ID,
   OWNER_REHEARSAL_CHECKSUM and the explicitly approved OWNER_REHEARSAL_RECIPIENT,
   then temporarily set OWNER_REHEARSAL_ENABLED=1. Never enable customer delivery
   to perform this owner rehearsal. Configuration changes remain a separate gate.
5. Request hosted delivery of only {reportId,checksum,expectedRecipient}. Record
   ACCEPTED and the provider message ID first; acceptance is not delivery.
6. Restore OWNER_REHEARSAL_ENABLED=0 after the authorized attempt, keeping
   LIVE_DELIVERY=0. Preserve the identity pins for exact receipt readback through
   /api/internal/automation/reconcile-delivery. A success response includes exact
   reportId/checksum, durable deliveryStatus and a whitelisted receiptEvent:
   accepted is still pending; delivered is verified; failed is not delivery.
   Do not infer receipt from checked/confirmed counts alone. A mismatching selector
   or missing accepted/delivered/failed attempt fails closed without a batch scan.
7. If runtime readback lacks permission, use an already authorized supported
   provider read tool to observe the exact receipt separately, or request the
   owner's specific permission decision. Do not expand key permissions by default.
   Independently check the owner's inbox if inbox arrival is an acceptance criterion.

Owner-only receipts cannot establish a customer's first-delivered timestamp or a
market's first-approved timestamp. Do not turn a test payment/customer into an
active customer merely to test email.

Resend also offers delivered@resend.dev, bounced@resend.dev,
complained@resend.dev and suppressed@resend.dev for synthetic provider events.
These simulate events, not a human inbox. Explicit owner rehearsals target only the exact approved OWNER_REHEARSAL_RECIPIENT
pin; a request cannot override it. Legacy live owner sends retain OWNER_EMAIL. Do not
change the owner login allowlist to a synthetic address or use a real customer
record to work around that isolation.

Official references:
- [Default-sender recipient restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- [Synthetic test addresses](https://resend.com/docs/dashboard/emails/send-test-emails)

### 3. Live customer delivery

This remains a separate launch decision. In addition to a successful provider
rehearsal, verify a sending domain and permitted sender, customer delivery consent,
active paid subscription, completed intake, unpaused/uncanceled/unsuppressed
customer status, current source coverage and a valid immutable report.

The first customer/market report requires exact authenticated owner approval.
Later automatic reports additionally require a real customer delivered receipt,
market approval history and the owner's progressive review setting. Owner-only
or mocked receipts do not satisfy those conditions.

Only then enable the Site LIVE_DELIVERY setting and, if authorized, GitHub's
WEEKLY_DELIVERY_ENABLED and receipt schedule. Merely adding configuration never
establishes launch approval.

## Alerts, failures and recovery

- Provider readback HTTP errors, transport timeouts, malformed JSON, mismatched
  message IDs and invalid event status create safe dashboard diagnostics and
  return HTTP 502 after the bounded pass. A missing stored provider message ID
  does the same without making a provider request. Each failed row's check
  timestamp rotates without changing its send lock, and later rows still get
  checked. Successful receipts in a partially failed pass remain durable; the
  response reports the first safe error code and aggregate checked, confirmed
  and failed-delivery counts. Provider bodies, headers and recipient details
  never enter those diagnostics or responses. The existing hourly workflow then
  opens one deduplicated GitHub issue for the unresolved reconciliation failure.
- A confirmed suppressed, bounced, complained or failed customer email blocks
  later customer delivery and creates a dashboard diagnostic. A canceled
  provider message is terminal without declaring its recipient unsafe.
- Owner alerts currently consist of dashboard diagnostics and GitHub issues.
  There is no separate Resend owner-alert email service. GitHub notification
  delivery depends on the owner's repository notification settings.
- Claimed/unknown sends are never cleared or resent by the receipt worker.
  Inspect the provider and reconcile them explicitly; do not delete locks.
- The hourly query covers accepted and delivered sends from the prior 30 days,
  at most four per invocation, ordered by oldest check across both statuses.
  Valid pending receipts and read failures both rotate to the back, so repeated
  failures cannot monopolize the batch or block delivered-message bounce checks.
  A later successful read resolves that row's readback diagnostic. Larger queues
  take multiple invocations; this is not a signed real-time webhook consumer.
- Provider reads are sequential, with 600 ms between requests and a five-second
  deadline spanning both fetch and response-body parsing. An explicit timeout
  race returns even if a fetch/body ignores abort. Four stalled reads plus three
  pacing intervals consume at most 21.8 seconds of provider wait/pacing, leaving
  8.2 seconds against the automation caller's 30-second timeout. This assumes
  timely runtime scheduling and excludes database/platform overhead; it is not
  an unconditional end-to-end response-time guarantee. Pacing limits this pass
  to less than two requests per second, but concurrent callers or other shared-key
  traffic can still cause throttling. There are no within-pass retries.
- API acceptance is never treated as confirmed delivery.
