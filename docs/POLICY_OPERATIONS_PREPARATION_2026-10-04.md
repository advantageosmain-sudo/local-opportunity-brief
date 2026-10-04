# Policy operations preparation

Status: local preparatory code and review design only. No customer-facing policy
change, deployed queue, database migration, provider call, refund, email, or data
deletion is included. Existing launch gates remain unchanged.

## Implemented safely

`lib/policy-operations.mjs` is a side-effect-free review planner. It accepts
verified records and an explicit `asOf`, returns minimal metadata, and cannot
send money, contact a provider, approve a request, or delete data. It supports:

- A recorded first-brief Monday, exact deadline instant, IANA time zone, and
  reference to the customer-visible promise. No implicit “intake plus seven
  days,” checkout-created, payment-updated, or report-generation deadline.
- Refund timing findings, with owner review on every result. “More than seven
  days late” is strictly greater than seven days. Error-based filings are within
  the stated window through the exact seven-day boundary. Timing alone does not
  establish a material error, usability, refund amount, or statutory entitlement.
- Retention review deadlines anchored to final lead decisions, cancellation,
  record creation, or diagnostic resolution. Missing anchors are visible;
  `updated_at` is never substituted. Legal/dispute holds keep the original
  maximum visible and require review. All outputs say execution is disabled.
- A deterministic, non-mutating owner queue that rejects duplicate identities
  and omits free-text notes, profiles, payment payloads and checkout capabilities.

No application route imports this module yet. It does not make the business
operationally ready by itself. The remaining integration is specified below.

## Verified repository facts and gaps

| Source | Current fact | Operational gap |
| --- | --- | --- |
| `app/page.tsx` | Every Monday; five opportunities | No customer-facing time zone or deadline time |
| `app/intake/page.tsx` | First brief follows the Monday cycle after review and checkout | A late checkout/payment can cross the intended Monday; no stored agreed first date |
| `app/cancellation/page.tsx` | First paid brief more than seven days late; error-based requests within seven days of delivery | No first-due anchor; no refund intake/decision ledger |
| `app/terms/page.tsx` and `business/CANCELLATION_REFUND_POLICY.md` | Seven-day request wording can read as applying to both refund grounds | Conflicts with the clearer error-only wording on the cancellation page |
| `app/privacy/page.tsx` and `business/DATA_RETENTION.md` | 90 days after final non-acceptance; profiles/reports up to 12 months after cancellation; receipts/payment events up to 24 months | No final-decision/cancellation timestamps or retention queue |
| `automation/README.md` | Monday job targets 09:17 America/Chicago | Job start time is not a delivery promise; first delivery requires owner approval |
| `app/dashboard/actions.ts` | A lead status change updates `updated_at` and audits it | Rejection has no durable immutable final-decision field; later updates must not restart its clock |
| `db/runtime.ts` | Tables are created with `CREATE TABLE IF NOT EXISTS` | Editing a CREATE statement does not migrate an already-created table |
| `lib/stripe-payments.mjs` | Live checkout requires completed intake and verified local source coverage | No exact first-date agreement is captured in checkout or payment ledger |

These are implementation findings, not a legal compliance determination.

## Owner decisions before integrating a new customer promise

1. First delivery deadline. Choose one:
   - Fixed rule: the Monday strictly after confirmed first payment, in
     America/Chicago, with an owner-approved delivery time. Example candidate:
     5 p.m. local Monday. This time is a proposal, not an existing promise.
   - Explicit per-customer date: quote the following Monday, delivery time and
     time zone before payment; bind checkout to that promise. A checkout that
     would miss the quoted cycle must expire or be requoted before charging.

   The exact choice and cutoff time need approval. First live payment, not a
   test payment, checkout session creation, intake creation or webhook processing
   time, is the payment evidence. An incomplete setup must not silently postpone
   an agreed deadline. If payment is asynchronous, preserve the quoted promise
   and route a missed cycle for review instead of silently resetting the date.
   Any schedule change needs a new version and customer-visible evidence; do not
   rewrite the historical promise against which an existing claim is evaluated.

2. Refund filing scope. Recommended clarification for approval: the seven-day
   filing window applies to material-error claims; a lateness claim can be
   received while the first brief remains undelivered. Decide any post-delivery
   filing limit for a late-first-brief claim explicitly. No such additional
   cutoff is encoded in the planner. Align terms, cancellation page and internal
   policy together only after approval; do not restrict existing claims by
   retroactively inventing a deadline.

3. Retention bookkeeping. Approve UTC 24-hour day intervals for the 90-day
   internal review cap and UTC calendar-month arithmetic (clamped at month end)
   for 12/24-month caps. The planner implements these as operational review dates only, never deletion authority. If customer-facing local-day
   interpretation is desired, review and test that separately before wiring it.
   Set a review reminder ahead of each maximum; discovering a record only at
   its cap does not fulfill “within” the stated period. For 24-month records,
   use original receipt/payment-event recorded time, not last webhook retry.
   Retain longer only for an individually recorded required reason and review.

4. Seller identification. Confirm this exact draft before publishing:

   “Local Opportunity Brief is operated by Michelle Shipe, DeWitt, Arkansas.
   For service, billing, cancellation, or privacy questions, contact
   mshipe2022@gmail.com.”

   These identity facts came from the owner's current task update. This draft
   makes no claim about an LLC, corporation, street address, tax registration,
   or legal sufficiency. No owned sending domain has been confirmed. The planned
   first pilot market is Benton, Arkansas; the actual business is still pending,
   so do not create a customer record or first paid deadline from the market alone.

## Durable data model to integrate after decisions

Use additive companion tables so existing production rows are not rewritten:

- `lead_final_decisions`: `id`, `lead_id`, `decision` (accepted/not_accepted),
  `final_decision_at`, `recorded_at`, authenticated `actor_email`,
  `evidence_reference`, `supersedes_id`, `revision`. Maintain immutable history
  and one current decision per lead. Final decision and the existing lead-status
  update must commit atomically with an audit record. Duplicate submissions use
  an idempotency key; the first timestamp must survive retries. A reconsidered
  lead requires an explicit superseding decision; routine edits cannot reset
  the clock. `approved_for_test_checkout` is not paid-customer acceptance.
- `customer_service_policy`: `customer_id`, `mode` (test/live),
  `policy_version`, `first_paid_at`, first paid invoice reference,
  `scheduled_monday`, `first_brief_due_at`, `delivery_time_zone`,
  `schedule_evidence_reference`, schedule revision, and cancellation event
  reference/time. The first-paid and original schedule anchors are write-once;
  corrections are separately reviewed history. Distinguish provider-recorded
  cancellation from an owner-only stop-reports action and from paid-period end.
- `refund_requests`: internal `id`, `customer_id`, external support-message
  reference (unique), ground, `requested_at`, optional report id/checksum,
  evidence reference, verification state, open/reviewed status, owner decision,
  `final_decision_at`, actor, reason reference and optimistic `revision`.
  “Approved for provider action” is separate from “refund processed.” Track
  amount/currency and verified provider refund reference only in the later,
  explicitly authorized provider workflow. Do not use the planner to deny claims.
- `retention_reviews`: category, subject id, source anchor type/time/reference,
  `review_by`, reviewer/decision/time, hold kind and evidence reference,
  `hold_review_by`, decision revision. A hold preserves the original maximum
  and an action-needed state; it must not silently restart or erase a clock.
  Keep processing receipts separate from customer data scheduled for deletion.
- Add a real diagnostic `resolved_at` event/time; changing `updated_at` while
  reviewing a diagnostic must not move its 90-day window.

Do not copy whole emails, provider payloads, card data, or identity documents into
these tables. Store necessary reference IDs and purpose-limited evidence only.

## Migration, authorization and export requirements

- Add an explicit, reviewed, numbered migration and align Drizzle declarations
  with runtime initialization. Existing `CREATE TABLE IF NOT EXISTS` is not a
  migration mechanism. Test both a clean database and an existing prior-schema
  database. Reruns must be idempotent; writes and audit events must be atomic.
- Old rejected rows have no trustworthy final timestamp just from `updated_at`.
  If a unique audited final rejection can be verified, propose a bounded backfill
  with its source reference. Otherwise label `missing_anchor` for the owner;
  do not assign migration time, intake time or an arbitrary old timestamp.
- The current database uses SQLite `CURRENT_TIMESTAMP` strings as well as ISO
  instants. A trusted adapter must explicitly convert the known SQLite UTC
  format into canonical milliseconds-Z strings. Never parse arbitrary local
  strings; never let browser time zones decide refund or retention clocks.
- Add a dedicated authenticated owner queue route/page with `Cache-Control:
  no-store`, a fixed allowlist of response fields, pagination and bounded request
  sizes. Use the platform-verified identity boundary plus exact `OWNER_EMAIL`
  allowlist. Mutation endpoints also need existing same-origin/CSRF protections,
  trusted server timestamps, revision checks, idempotency and auditable actor IDs.
  A caller-supplied identity header in a test harness is not live auth evidence.
- Keep queue access out of `/api/internal/operations` and general automation
  exports unless that separate access is explicitly reviewed. The existing
  operations export returns broad customer profiles and diagnostics; do not add
  refund narratives, retention holds, identity-verification records, scheduling
  capabilities or provider raw payloads to it. Owner surface code is separate:
  validate both public and owner artifacts when the queue is integrated.
- Customer access/copy requests need independent identity verification and a
  purpose-built per-customer export manifest. Exclude owner deliberations,
  other customers, secret/capability tokens and protected evidence. Export is
  not a side effect of a review-plan GET.
- A future deletion packet must enumerate every data copy and retention reason:
  leads, profiles, reports, decisions/feedback, delivery records and diagnostics,
  payment events, audit trails, checkout/recovery records, local outbox outputs,
  GitHub Actions artifacts, approved exports/backups and relevant processors.
  Respect durable duplicate-send/payment-event protection; deleting those keys
  can make a replay possible. Preserve appropriately minimized tombstones or
  another reviewed replay defense where required. No blanket cascade is safe.
- A queue decision must never execute a refund, permanently delete a record,
  change subscription billing, send a customer reply or accept legal terms.
  Those are separate authorized actions with their own exact target/evidence.

## Verification and release gates

The new unit suite covers exact seven-day boundaries, missing/invalid/future
anchors, Monday dates across UTC and Chicago DST, calendar-month leap-day
clamping, holds, diagnostic resolution, stable order, duplicate protection,
no input mutation and no private-field echo. No provider behavior is asserted.

Before treating the operational queue as ready, additionally verify migration
from the deployed schema, authenticated owner/non-owner and cross-origin cases,
repeated/stale decision submissions, trust in the platform identity boundary,
pagination/completeness, export minimization, and real support-to-queue receipt
without any customer disclosure. Freeze the owner-approved wording and exact
first-date rule before altering checkout, terms or cancellation pages.

### Local verification snapshot

Base: local commit `a6ccdbcbb2fdd50f195f700309008cf38d9e5b65`, tree
`54c163823112a65e775eba440ae41ca615b0c1f8`.

- New planner tests: 19/19 passed.
- Application typecheck and lint: passed.
- Production artifact build and artifact validation: passed.
- Full suite: 626/627 passed. The existing
  `tests/offline-completion-chain.test.mjs` owner-approval test fails after UTC
  midnight because its fixture takes UTC's current date, while
  `isCurrentOwnerReport` defaults to America/Los_Angeles's current date. At
  00:04 UTC on October 4, the fixture is October 4 and the owner gate is still
  October 3, so it returns “This report is no longer current.” The same test
  was reproduced against the baseline build in a read-only check. The integrating
  task first aligned the fixture with the existing guard, then identified the same
  mismatch in a newly generated pilot. The integrated repair aligns the owner
  report-date guard with hosted UTC report validation through `currentReportDateKey`;
  Chicago scheduling and customer deadline proposals remain separate. This
  clock repair was not part of the isolated planner patch. The planner is not imported by
  any application route. This is a separate clock-consistency repair; this
  preparatory patch does not weaken that gate or alter the test to hide it.
- No live/provider/database migration or authentication claim is made.
