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

Expired approved sources produce `MARKET_SOURCE_FRESHNESS_EXPIRED`; other
currently invalid approved evidence produces `MARKET_SOURCE_INVALID`. They
remain excluded from generation while the existing blocked-source summary,
diagnostics and failure alert retain the service problem visibly. Assessment
never changes saved approval, source-check dates, registry bytes or delivered
history. QA identities remain excluded from both customers and diagnostics.
