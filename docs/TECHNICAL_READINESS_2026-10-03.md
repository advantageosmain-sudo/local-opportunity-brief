# Technical readiness — October 3, 2026

This records the completion repair package and its evidence. Code readiness is
not live-business authorization. PR11 was approved and merged as
`c8141f21fc2859fcacdb14d59d6eb5d0a9de497a`; post-merge CI run 37127364979 passed.
The existing Site reached version 17 at 13:49:54 UTC with unchanged environment
revision 13. Its source tree matched the approved GitHub tree exactly. A cloud
browser check confirmed the corrected canceled-sandbox label, zero real customers
and disabled historical-report approval. No email was attempted.

The follow-on owner-report workflow and separately pinned rehearsal gate are
prepared changes, not yet deployed by that version. They need their own exact-head
approval and verification. The report's chat approval is recorded, but hosted
sync and the dashboard decision still await the corrected workflow.

## Implemented and testable

- Intake validation, retained owner-only QA records and signed owner access.
- Independent QA identity/payment/profile classification across dashboard,
  automation export, operations and customer delivery, including malformed data.
- Stripe test Checkout, signed current-state reconciliation, event dedupe,
  subscription leases, hosted Portal and cancellation.
- Guarded archived-evidence validation for replay of the one reviewed rejected
  checkout; it never removes a newer attempt or replays a successful payment.
- Privacy-safe webhook error categories without weakening failure retries.
- Source-based five-opportunity reports, immutable sync and exact owner approval.
- Atomic delivery/duplicate prevention, accepted-versus-delivered receipts,
  recipient suppression and a final QA/consent recheck inside the send claim.
- Clean TypeScript verification using generated, pinned Cloudflare D1 contracts.
  Type checking is now part of CI rather than a documented failed baseline.

The end-to-end offline regression exercises QA intake, a mocked Stripe payment,
QA exclusion, a separate owner-only report, authenticated exact-checksum approval,
disabled delivery, mocked acceptance and receipt, duplicate prevention and weekly
DST selection. All provider requests in this test are intercepted; it neither
uses real credentials nor sends email. Owner-only receipts do not establish a
customer's delivery history or release real-customer launch gates.

## Actually observed in the sandbox

See the separate sandbox rehearsal record for identifiers and timestamps. The
$49 USD monthly test invoice was paid, all three signed creation/payment events
were accepted, and the local QA record became test-active. Hosted Portal and its
immediate cancellation then passed, with a signed deletion event producing
`test_canceled`. No new test subscription is needed to repeat this evidence.
The initial concurrent 503 cause is still unproven; retries succeeded.

Real provider-clock renewal and failed-payment collection have not been tested.
Their application-state handling is covered by synthetic signed-event tests.

## Scheduling and delivery boundaries

The refreshed draft is retained in
`evidence/owner-test-olympia-future-2026-10-03/`. Its immutable report ID is
`owner-test-olympia-future-2026-10-03`, checksum
`0d1635457fbe814edbf4e374edffe7978a1629a968fdaedd31929889b923a408`.
It has five future-only opportunities and received exact chat approval on October
3 at 13:45 UTC. Its immutable packet remains pending until synchronized and the
authenticated dashboard decision is recorded; delivery stays disabled. The
current seven-day UTC validation gate expires after October 10 at 00:00 UTC;
revalidate at the actual approval/send time and regenerate under a new identity
if stale. The host-calendar-only evidence for Harvest Fest and SUP listing
conflicts are disclosed in the report. Nothing here authorizes a send.

The existing GitHub weekly workflow selects Monday at 09:17 America/Chicago
using both UTC schedules and a runtime DST guard. Do not create a duplicate
Site schedule. Manual and scheduled customer sends remain subject to existing
approval, subscription, source, consent and delivery gates. An hourly receipt
workflow remains disabled while its delivery variable is off.

Fresh hosted inspection found one canceled QA customer, zero real customers,
three old pending reports, no report decisions and no delivery attempts. Site
environment revision 13 retained `PAYMENTS_MODE=test`, `LIVE_DELIVERY=0`,
`LIVE_CHECKOUT_VERIFIED=0`, and `PROVIDER_CAPACITY_VERIFIED=0`. It had no
`RESEND_API_KEY` or `DELIVERY_FROM_EMAIL`. The Resend plugin was available but
not connected, so provider account/sender status was not established.

## Gates still requiring evidence or owner action

1. Approve the follow-on source head for the parameterized frozen-owner workflow
   and isolated owner rehearsal gate before its merge/deployment. Version 17
   alone does not contain these changes.
2. Synchronize the already approved exact owner packet and record its matching
   authenticated dashboard decision. Validate freshness again at each step.
3. Connect/verify the email provider and a permitted sender. Configure credentials
   only through the approved secure flow. New credentials or expanded access
   require their own confirmation; never paste keys into source or chat.
4. The one exact report email to the owner is conditionally approved, with no
   spending, only after sender verification and secure setup. Use the separate
   pinned owner gate and keep customer LIVE_DELIVERY=0. Provider acceptance,
   delivered receipt and human inbox arrival are separate verification levels.
5. Before any public paid launch, separately establish customer consent and
   actual source coverage, owner business/legal/tax decisions, approved live
   provider configuration and spending/launch authority. No code test, synthetic
   record or owner-only report supplies those human/business decisions.

Historical October 2 reports and evidence remain preserved as history; they do
not become current merely because new code passes. This package does not enable
live payments, send customer email, buy services or claim market demand.
