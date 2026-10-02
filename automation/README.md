# Report automation and delivery contract

## Eligibility and authority

The weekly job reads `/api/internal/automation/customers` from the hosted service
using `REPORT_SYNC_SECRET`. Committed profiles are demonstrations and owner
research rehearsals, not the paying customer database. Production generation
requires active customer + active paid subscription + completed intake + valid
email + no pause, cancellation or suppression. The hosted service rechecks all
of those immediately before attempting a send.

First reports for each customer and each market require an authenticated human
owner's approval of the exact report checksum. Later delivery may proceed only
after a human-approved first report has a provider-confirmed delivered receipt,
and only when the owner's `require every review` setting is off. Automation never
creates a human approval. `approve.mjs` is intentionally disabled.

## Sources and output

A profile can name `marketProfileFile` from `automation/markets/`; its market
profile lists reusable `approvedSourceFiles`. Hosted customer exports carry
resolved `sourcePacks`, keeping customer PII out of source control. Packs and
opportunities carry the same `marketId` as the customer.

Live opportunities require an official government, school, organizer, destination
office, or customer-first-party source, opened/verified status and a check no more
than 14 days before the report date. Events must be in the next 30 days and still
have a usable preparation date. Selection filters the customer's products,
audiences and exclusions. Duplicate event evidence cannot count twice. Anything
other than exactly five validated opportunities yields a blocked diagnostic;
missing research is never padded with invented events.

`geographyMode: "distance"` requires a numeric distance within the customer's
radius. `geographyMode: "city_match"` permits an explicit exact city/state match
when no street address is available, with `distanceMiles: null` and an explanatory
`geographyBasis`. That mode does not assert a measured radius or store proximity.

Each successful packet contains report JSON, Markdown, email preview, source
snapshot, research validation, report validation, pending approval, and dashboard
sync JSON. Per-source recommendations, event time, venue, risk warnings and
geography notes are preserved. Source dates without displayed publication dates
remain explicitly unknown.

Generation claims serialize concurrent processes. An identical customer/date
report hash is reused without resetting its approval or receipt. Different
contents for an existing report date produce `GENERATION_HASH_CONFLICT`; the
existing evidence remains unchanged. Revision requires owner reconciliation.

## Chicago schedule

GitHub Actions cron is UTC. Both Monday `17 14 * * 1` and `17 15 * * 1` are declared.
`automation/schedule.mjs` selects only the expression corresponding to
America/Chicago's current UTC offset, targeting 09:17 local Monday in both CDT and
CST. It keys off the triggering expression rather than exact runner start minute,
so a delayed job can still run. A runner delayed beyond Monday safely skips.
Customer/date report identity and durable hosted claims prevent repeat sends.

Manual runs default to Chicago's current date. Historical demonstrations use an
explicit historical date and remain undeliverable. August and September evidence
must not be described as current October research.

## Delivery and receipts

The production workflow syncs packets to `/api/internal/reports`, then optionally
calls `/api/internal/automation/deliver` with only report ID and checksum. It does
not carry a provider key and cannot upload an approval or provider receipt.
`WEEKLY_DELIVERY_ENABLED=true` enables scheduled hosted requests; the default is
review-only. Manual `process_delivery` also only requests the hosted checks.

The hosted service owns persistent claims, approval, suppression and provider
receipt reconciliation. HTTP acceptance from an email API means `ACCEPTED`, not
`DELIVERED`. Unknown outcomes must stay locked until provider reconciliation.
Blocked generation diagnostics sync to `/api/internal/diagnostics`; GitHub failure
alerts are deduplicated using a stable customer/date marker across all issue
pages, including closed issues. Artifacts preserve each run's diagnostics.

The separate `lib/delivery.mjs` adapter is unit-tested with fake transport only.
It requires a durable-authorization callback; an editable local approval file is
insufficient. It uses report/hash idempotency, atomic claims, uncertainty locks,
rate-limit backoff with a three-attempt ceiling, invalid-recipient suppression,
and one persisted owner-alert record. Network failures and HTTP 5xx/408/409 are
ambiguous and never retried automatically. It renders from the checked report
instead of trusting a mutable email-preview file.

## Verification commands and limits

- `node --test automation/tests/*.test.mjs`: mocked unit/integration tests
- `node automation/run-all.mjs`: eligible local profile dry run, never email
- `node automation/run-all.mjs --hosted`: authenticated hosted export + local packets
- `node automation/sync-dashboard.mjs --summary <summary.json>`: sync reports/diagnostics
- `node automation/deliver.mjs --summary <summary.json>`: request hosted delivery

Tests cover eligibility, first-customer/market review, human approval, all-review
mode, both DST transitions, immutable generation, insufficient/old/wrong-market
research, duplicate events, geography, provider failure, retry backoff, uncertain
locks, suppression and exact hosted request contracts. Mock test success is not
payment-provider, sender-domain, live webhook, inbox, or actual delivery proof.
No real email or workflow is dispatched by running the test suite.
