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
- Lemon Squeezy checkout and signed-webhook handling restricted to test mode
- Locked launch, spending, payment, email, research, and approval rules

## October 2 operational finish

See `docs/OPERATIONAL_FINISH_2026-10-02.md` and `evidence/e2e-2026-10-02.json` for current scoped implementation, exact tests and unresolved provider launch gates. Public checkout and delivery remain disabled until real provider verification. The fresh Olympia owner test is preserved under `evidence/owner-test-olympia-2026-10-02/`; historical examples below are not current research.

## Safe default state

The checked-in system cannot charge a customer, send a live email, purchase
anything, or approve a public launch.

Live delivery requires all of the following:

1. A real, non-fixture report
2. Five passing opportunities inside the 30-day window
3. A customer profile whose delivery mode is explicitly `customer`
4. An approval file whose checksum still matches the report
5. The protected GitHub `outbound-delivery` environment
6. `LIVE_DELIVERY=1`, a Resend key, and a configured sender

The provider request also receives a report-specific idempotency key. A local
atomic claim prevents two processes from sending at the same time.

## Install and verify

Requirements:

- Node.js 22.13 or newer
- Linux with `flock`, `curl`, and GNU `timeout`

```bash
npm ci
npm run lint
npm test
```

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

The full beginner-safe test setup is in `docs/OWNER_TEST_SETUP.md`.

Important values:

- `OWNER_EMAIL` — owner dashboard allowlist
- `REPORT_SYNC_URL` and `REPORT_SYNC_SECRET` — exact report-to-dashboard link
- `PAYMENTS_MODE=disabled|test|live` — live additionally requires verified provider configuration and `LIVE_CHECKOUT_VERIFIED=1`
- `LEMON_SQUEEZY_CHECKOUT_URL` and `LEMON_SQUEEZY_WEBHOOK_SECRET` — test mode only
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

