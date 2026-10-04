# Bounded weekly source research and review

This is an operator procedure plus a read-only queue. It creates no schedule,
paid research job, browsing agent, source verification, approval or customer send.
The existing GitHub workflow packages stored sources; it is not a research runtime.

## Minimum service commitment

Before enrolling a real customer, choose the actual service market, confirm five
useful first-party opportunities can be maintained, and name the person or an
explicitly funded and available research runtime responsible for weekly work.
Do not sell nationwide automated research on the strength of one Olympia sample.
Keep the first customer and new-market report under explicit owner review.

Use the existing Monday 09:17 America/Chicago packet run. No duplicate schedule
is needed. The operator should review the queue by Friday, perform bounded
research/rechecks over the weekend, and finish source and report review before
delivery. Budget work per served market rather than per overlapping customer:
five qualifying opportunities within the next 30 days, plus enough reserves for
cancellations. Check again on Monday if a source is close to the fourteen-day
source limit. The report must remain within its separate seven-day window. The
queue uses the last complete UTC day before the fourteen-day source timestamp
cutoff; the run schedule uses America/Chicago.

If evidence cannot be verified or fewer than five opportunities qualify, leave
the market blocked, retain diagnostics, and decide how to fulfill the customer's
commitment. Never update sourceCheckedAt merely to keep the automation green.

## Supported source path

1. Open `/dashboard/source-review` as the configured owner. Missing, stale,
   candidate-only, wrong-market and pending-approval evidence is explicit.
   A two-day freshness warning is a planning hint, not an automatic refresh.
2. For an approved feed configuration, run:
   `node automation/ingest-sources.mjs --config /private/market-ingestion.json --out-dir /private/new-source-review-directory`
   This is a manual read-only fetch of configured public feeds. It writes a new
   `registry-candidates.json` and `ingestion-diagnostics.json`; receipts preserve
   configured URL, fetch time, content hash and response metadata. Candidates
   retain null sourceCheckedAt, unverified authority and pending-owner status.
3. A real operator opens original source pages and verifies first-party ownership,
   dates, geography, preparation dates and customer fit. Preserve fetch receipts
   and original URLs when preparing the separate reviewed pack. Human verification
   time and evidence belong to the actual reviewed source, not the time CI ran.
4. Submit `{marketId, sourcePacks}` to the existing authenticated
   `POST /api/internal/markets`. Use its already approved internal authorization
   path; never put the sync secret in source or chat. An absent market is an error.
   The endpoint accepts only current, non-fixture, matching-market validated
   evidence with at least five distinct upcoming opportunities and stores
   `pending_review`. It cannot approve coverage.
5. Inspect the exact stored evidence at `/dashboard/source-review`, then approve
   its fingerprint through the authenticated owner form. Stale pages, stale
   evidence, concurrent replacement and repeated approval fail closed. The audit
   retains the fingerprint, actor, assessment date and validity window. This
   approval does not establish first-customer or first-market delivered history.
6. Only `verified` market registries are exported into the existing weekly
   customer workflow. A replacement becomes pending and blocks that market's
   export and customer send claim until exact review. Packet validation, customer
   consent/payment, owner report review, duplicate protections and delivery
   switches still apply independently. Generated reports retain their own source
   snapshot and immutable checksum. Refreshing sources never rewrites a report.

## Launch evidence still needed

- Real source coverage for the owner's chosen market and a named weekly operator.
- A genuine next-week source refresh and customer-fit report review.
- An actual provider-clock renewal/failure/recovery rehearsal. Offline tests do
  not satisfy that evidence.
- Live provider, legal/tax and spending decisions. Consider Stripe Tax only after
  jurisdiction/registration decisions; this procedure does not enable tax or
  assert that enabling a switch makes collection compliant.
- Explicit permission before enabling any new runtime, paid service or delivery.

## Blocked paid service is visible

The authenticated customer export excludes unapproved or missing markets from
eligible profiles, but emits optional `blockedSourceCount` and `blockedSources`
containing only opaque customer/market IDs and fixed reason codes. The hosted
runner validates this protocol, preserves requested-customer filtering, writes
ordinary `BLOCKED` result entries without generating reports, and exits with
failure. The existing diagnostic synchronization and deduplicated weekly failure
alert can then identify an unfulfilled paid-service obligation. Empty accounts
and QA-only accounts remain normal empty successes. This patch neither runs the
workflow nor sends an alert.

## Current evidence at export

A saved `verified` status records the owner decision; it is not perpetual source
eligibility. Each hosted export assesses the stored registry against one current
UTC date, including its market geography, preparation window and source age.
Evidence expires at the start of UTC day `sourceCheckedAt + 14 days`; exactly
fourteen days is expired in source, report and hosted delivery validation alike.
The last valid complete UTC day is `sourceCheckedAt + 13 days`.

Expired approved sources produce `MARKET_SOURCE_FRESHNESS_EXPIRED` only when
expiration is the sole evidence defect. Concurrent defects, such as an
unapproved authority, unsafe evidence URL, missing fields or invalid preparation
window, produce `MARKET_SOURCE_INVALID`. The read-only owner assessment retains
fixed validation reason codes for every detected defect; refreshing dates alone
cannot hide the remaining problems. Pending owner approval is recorded separately.
Other currently invalid approved evidence also produces `MARKET_SOURCE_INVALID`. They
remain excluded from generation while the existing blocked-source summary,
diagnostics and failure alert retain the service problem visibly. Assessment
never changes saved approval, source-check dates, registry bytes or delivered
history. QA identities remain excluded from both customers and diagnostics.

## Bounded operations checkpoint — October 4, 2026 UTC

- Run/finding ID: `lob-source-diagnostic-discussion_r4175795996`.
- Scope: `advantageosmain-sudo/local-opportunity-brief`; source main
  `7ff0c646fda443d764c456b37bf3a9b0fa72e00e` (all 223 source blobs verified).
- Source finding: PR17 review `discussion_r4175795996`, posted after merge.
  A stale source with an unapproved authority, unsafe URL or missing required
  tags lost the concurrent defect in assessment and exported a freshness-only
  diagnostic. Three new regressions failed on unchanged main and passed after
  the repair. The existing excluded/eligible decisions remain unchanged.
- Prior checkpoint: no continuous-operations receipt or repository lock found.
  Writes are serialized, with fresh source/approval/ref reads; there is no
  cross-run lease. No matching open PR or repair branch existed at inspection.
- Prepared branch: `ops/source-diagnostic-4175795996`. Exact remote head and
  persistence verification are reported by the task result; this checkpoint
  does not claim its own future commit has already been persisted.
- Completed local work: fixed allowlisted source-validation reason codes,
  retained concurrent assessment reasons, freshness-only classification only
  when no other evidence defect remains, and nine behavioral regressions.
- Verified: 79/79 focused offline tests, clean typecheck and lint, fresh local
  build and artifact validation, business demo/pilot/frozen October2 validation,
  and active-customer dry run (zero eligible local profiles, no hosted export).
  Local runtime: Node24.19.0; GitHub validation uses Node22. No live readiness
  conclusion follows from these checks.
- Attempted full suite: execution was rejected by automatic approval review
  because it attempted `workers.cloudflare.com` access outside this task's
  GitHub-only scope. No completed full-suite PASS is claimed. No retry or
  indirect full-suite execution is authorized by this record.
- Review status: `PROGRESS`, with full-suite validation blocked. PR opening is
  withheld because the existing pull-request workflow automatically runs that
  suite. Branch pushes have no automatic deployment or validation trigger in
  the four inspected repository workflows. No workflow is changed here.
- Reconciled existing work: open PR8 and draft PR12 have unchanged heads and
  no unresolved review threads; their repairs are already included through
  merged PR11. They are left untouched. Current-main validation run
  `37170359225` passed. Owner receipt-reconciliation run `37170582979` failed
  HTTP502; provider-backed durable receipt remains unverified through GitHub.
  No retry, provider call or send was performed in this cycle.
- Blocker signature: `FULL_SUITE_SCOPE_WORKERS_CLOUDFLARE_COM`; separate
  unresolved receipt signature `37170582979:owner_rehearsal_reconcile:HTTP502`.
- Next step: review this exact branch, then obtain a permitted full-suite
  verification path before opening/approving a merge PR. Continue the existing
  receipt investigation separately without resend. Reuse this stable finding
  and branch; do not create another repair or append unchanged hourly receipts.
- Preserved: test billing, customer email off, owner report approval, live
  checkout and all provider/production/spending gates. No main write, merge,
  deployment, settings/secrets/permissions change, eligibility change, email,
  billing action or alteration of the weekly opportunity automation.
