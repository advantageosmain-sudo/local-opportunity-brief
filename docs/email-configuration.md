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
- OWNER_EMAIL: the verified owner login email and owner-only report destination.
- REPORT_SYNC_SECRET: the existing shared automation secret, matching GitHub.
- RESEND_API_KEY: a privately configured provider key. The current implementation
  uses this one key both to send and to retrieve sent-message status.
- DELIVERY_FROM_EMAIL: a provider-permitted sender address.
- LIVE_DELIVERY: keep 0 until an exact authorized send rehearsal or separately
  approved customer launch. Both owner-only and customer sends require 1.

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

Resend's sending_access permission cannot perform GET /emails/:id. With the
current single-key configuration, automated receipt reconciliation requires a
full_access key. This access is broader than sending and must be an explicit
owner-controlled decision. A send-only key may prove API acceptance, but cannot
prove receipt reconciliation.

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
   OWNER_EMAIL must match that permitted recipient, or use an appropriately
   verified sender domain.
2. Use a current source-validated report with deliveryMode owner_review_only.
   Synchronize it to the Site and have the authenticated owner approve its exact
   checksum. A synthetic QA customer record is not a substitute for this packet.
3. Configure the Site values above through the secure settings flow. Keep
   PAYMENTS_MODE disabled and scheduled customer delivery disabled.
4. Obtain explicit approval for the exact owner send before temporarily enabling
   the Site's LIVE_DELIVERY. The current code has no separate owner-only provider
   switch: LIVE_DELIVERY=1 also enables the customer endpoint's existing
   eligibility gates. Prefer an isolated private rehearsal backend/database;
   otherwise verify no other eligible delivery is scheduled or in flight.
5. Request hosted delivery of only that report ID/checksum. Record ACCEPTED and
   the provider message ID first. Retrieve the matching provider receipt before
   recording DELIVERED. Independently check the owner's inbox if inbox arrival
   is part of the acceptance criteria.
6. Restore LIVE_DELIVERY=0 after the authorized rehearsal. Receipt readback can
   still be requested directly on the authenticated backend after new sends are
   disabled. The checked-in hourly workflow itself remains controlled by its
   GitHub LIVE_DELIVERY variable.

Owner-only receipts cannot establish a customer's first-delivered timestamp or a
market's first-approved timestamp. Do not turn a test payment/customer into an
active customer merely to test email.

Resend also offers delivered@resend.dev, bounced@resend.dev,
complained@resend.dev and suppressed@resend.dev for synthetic provider events.
These simulate events, not a human inbox. The current owner-only route always
targets OWNER_EMAIL; it does not provide a sandbox-address override. Do not
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
  return a failing response. The existing hourly workflow then opens one
  deduplicated GitHub issue for the unresolved reconciliation failure.
- A confirmed suppressed, bounced, complained or failed customer email blocks
  later customer delivery and creates a dashboard diagnostic. A canceled
  provider message is terminal without declaring its recipient unsafe.
- Owner alerts currently consist of dashboard diagnostics and GitHub issues.
  There is no separate Resend owner-alert email service. GitHub notification
  delivery depends on the owner's repository notification settings.
- Claimed/unknown sends are never cleared or resent by the receipt worker.
  Inspect the provider and reconcile them explicitly; do not delete locks.
- The hourly query covers accepted and delivered sends from the prior 30 days,
  at most 50 per invocation. It is not a signed real-time webhook consumer.
- API acceptance is never treated as confirmed delivery.

