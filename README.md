# Local Opportunity Brief

Local Opportunity Brief is a repository-controlled subscription-business system
for independent boutiques, gift shops, and local apparel stores.

It includes:

- A sales site, complete sample, founding-request form, privacy policy, and terms
- An owner-only command dashboard backed by durable storage
- A 30-day local-opportunity ranking and report engine
- Live-source, date, location, wording, duplication, and customer-fit gates
- A scheduled all-active-customer Monday run
- Exact report synchronization from GitHub Actions to the owner dashboard
- Owner-bound report approval and protected outbound delivery
- Atomic and provider-level duplicate-email prevention
- Delivery failure diagnostics and a deduplicated owner alert
- Stripe-hosted subscription Checkout, signed/idempotent webhooks and Billing Portal
- Authenticated owner-only sandbox billing controls isolated from real delivery
- Locked launch, spending, payment, email, research, and approval rules

## Reusable skills and agents

The prioritized repo-local skills and Codex agent profiles for Product Readiness,
Digital Product Production, and Business Records are cataloged in
`docs/CAPABILITY_CATALOG.md`; the dated task/decision record is
`docs/agent-capability-build-2026-10-04.md`. These reuse the existing business,
report, approval, and records architecture and do not add a scheduler or worker.
Run `npm run capabilities:check` to validate the instruction and agent files.

## Current technical readiness

Start with `docs/TECHNICAL_READINESS_2026-10-03.md` for the current tested repair
package, actual sandbox evidence, refreshed owner packet and remaining launch
gates. `docs/sandbox-rehearsal-2026-10-03.md` records the completed test payment,
signed webhook reconciliation, Portal and cancellation rehearsal.

## Stripe and email integration review

See `docs/stripe-configuration.md` and `docs/email-configuration.md` for the current
provider wiring, secure configuration plan and unverified launch gates. Code tests
use synthetic provider boundaries; only the separately recorded sandbox rehearsal
establishes provider-backed results. Neither proves live payments or email delivery.

## October 2 operational finish

`docs/OPERATIONAL_FINISH_2026-10-02.md` and `evidence/e2e-2026-10-02.json` are historical snapshots, not the current provider status. Their original limitations and corrected deployment claims are preserved. The October 2 Olympia packet is historical and cannot be approved once its event dates expire. Public checkout and delivery remain disabled until their separate launch gates pass.

## Safe default state

The checked-in system cannot charge a customer, send a live email, purchase
anything, or approve a public launch.

Live delivery requires all of the following:

1. A real, non-fixture report
2. Five passing opportunities inside the 30-day window
3. A customer profile whose delivery mode is explicitly `customer`
4. An approval file whose checksum still matches the report
5. The existing hosted route’s durable approval and customer eligibility checks
6. Site `LIVE_DELIVERY=1`, a Resend key, and a configured sender

The provider request also receives a report-specific idempotency key. A local
atomic claim prevents two processes from sending at the same time.

## Install and verify

Requirements:

- Node.js 22.13 or newer
- Linux with `flock`, `curl`, and GNU `timeout`

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

`npm run typecheck` checks both application surfaces and their Worker entry points.
D1 declarations are generated from the pinned Wrangler runtime into the
module-scoped `types/cloudflare-d1.d.ts`, so Cloudflare globals do not override
browser `Request`/`Response` types. Run `npm run types:generate` after upgrading
Wrangler; keep `types/wrangler-types.jsonc` aligned with the build's compatibility
date and flags. Generation is local and does not contact a database or deploy.

The complete test suite builds the site and verifies research, report generation,
dashboard packet integrity, duplicate delivery protection, failure diagnostics,
test checkout links, and signed test webhooks without contacting an email or
payment provider.

## Run the demonstration

```bash
npm run business:demo
```

This writes a visibly labeled fictional packet under:

```text
automation/outbox/demo-boutique/2026-08-03/
```

Demo packets can never be delivered.

## Run the genuine owner-only research pilot

```bash
npm run business:pilot
```

This creates a five-opportunity Olympia packet using source pages checked on
2026-08-02. The profile is `owner_review_only`, so it cannot be emailed to a
customer even though its evidence is real.

The source audit is in:

```text
business/evidence/OLYMPIA_OWNER_PILOT_2026-08-03.md
```

## Run the Monday batch safely

```bash
node automation/run-all.mjs --as-of 2026-08-03
```

The scheduled command processes only profiles with `status: active`. It excludes demo, unpaid, canceled, paused and incomplete profiles. First-customer/market reports stop for owner review; progressive delivery also requires verified first delivery, source checks and configured owner policy.

For a private pilot rehearsal:

```bash
npm run business:batch
```

## Generated approval packet

Every successful report directory contains:

- `research-validation.json`
- `report.json`
- `report.md`
- `email-preview.txt`
- `validation.json`
- `approval.json`
- `dashboard-sync.json`

A blocked run writes `diagnostic.json`. A failed delivery writes
`delivery-failure.json`; an unknown network outcome writes
`delivery-uncertain.json` and blocks automatic retry.

## Hosted configuration

Current setup is in `docs/stripe-configuration.md` and `docs/email-configuration.md`.
The original owner test setup is retained for history and is superseded where noted.

Important values:

- `OWNER_EMAIL` — owner dashboard allowlist
- `REPORT_SYNC_URL` and `REPORT_SYNC_SECRET` — exact report-to-dashboard link
- `PAYMENTS_MODE=disabled|test|live` — live additionally requires verified provider configuration, `LIVE_CHECKOUT_VERIFIED=1` and `PROVIDER_CAPACITY_VERIFIED=1`; both gates stay unset/0 until independently verified and owner-approved
- `STRIPE_API_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIGURATION_ID` and `PUBLIC_SITE_URL` — protected Site runtime configuration
- `PAYMENTS_PROVIDER=stripe` — default; legacy Lemon Squeezy requires explicit selection
- `RESEND_API_KEY`, `DELIVERY_FROM_EMAIL`, and `LIVE_DELIVERY` — protected delivery only

Never commit real values. `.env.example` contains names and safe defaults only.

## Launch status

The technical system is substantially complete, but the business is not cleared
for public launch. See:

- `business/TECHNICAL_READINESS.md`
- `business/LAUNCH_CHECKLIST.md`
- `business/CANCELLATION_REFUND_POLICY.md`
- `business/DATA_RETENTION.md`

Provider tests, retailer feedback, owner configuration, legal review, and public
launch approval remain outside gates. No passing code test can silently satisfy
those decisions.

