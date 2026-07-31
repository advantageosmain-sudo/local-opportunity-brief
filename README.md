# Local Opportunity Brief

Local Opportunity Brief is a runnable, repository-controlled subscription
business for independent boutiques and gift shops.

It provides:

- A public sales page
- A complete sample weekly brief
- A persistent founding-member intake form
- An owner-only operations dashboard
- A deterministic opportunity-ranking and report-generation engine
- Evidence, relevance, date, wording, and delivery checks
- Owner-gated outbound delivery
- GitHub workflows for validation and weekly report runs
- Locked business, pricing, brand, source, approval, and launch rules

## Safe default state

The system is fully runnable in demonstration mode. It cannot charge a customer,
send a live email, purchase anything, or publicly launch itself in the
checked-in state.

Live email requires all of the following:

1. A non-fixture report
2. Passing validation
3. An approval file whose checksum matches the report
4. Owner approval
5. `LIVE_DELIVERY=1`
6. A configured Resend key and sender

## Run locally

Requirements:

- Node.js 22.13 or newer
- Linux with `flock`, `curl`, and GNU `timeout`

Install and verify:

```bash
npm ci
npm test
npm run business:demo
```

Start the application:

```bash
npm run dev
```

The demonstration report is written to:

```text
automation/outbox/demo-boutique/2026-08-03/
```

## Operate a weekly dry run

```bash
node automation/run.mjs --customer demo-boutique --as-of 2026-08-03
```

The report always stops at `PENDING_APPROVAL`. Fixture reports are permanently
blocked from live delivery.

## Important locations

- `BUSINESS_MANIFEST.json` — business source of truth
- `business/` — pricing, brand, approvals, sources, operations, launch gate
- `automation/customers/` — customer profiles
- `automation/sources/` — normalized opportunity evidence
- `automation/lib/engine.mjs` — scoring, generation, and validation
- `automation/outbox/` — generated approval packets and delivery records
- `.github/workflows/` — validation and weekly operating workflows
- `app/` — public site, intake, sample, dashboard, and API routes
- `db/` — persistent intake and report records

## Before accepting live customers

Complete every item in `business/LAUNCH_CHECKLIST.md`. Public launch, payment
activation, live email, spending, and price changes remain owner decisions.
