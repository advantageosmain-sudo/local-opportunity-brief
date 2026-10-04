# Repository agent guardrails

This repository is the GitHub source of truth for **Local Opportunity Brief**.
Before acting, read `BUSINESS_MANIFEST.json`, `README.md`, and the applicable
policy and readiness records. The checked-in manifest describes one business;
do not infer or add another business, market, customer category, or customer
record from an example or planning note.

## Preserve the existing architecture

- Reuse the existing report engine, source validation/review, immutable report
  packets, hosted owner approval, delivery gates, payment controls, policy
  planner, and retention rules. Do not create parallel queues, approval files,
  customer stores, schedulers, or delivery systems.
- `BUSINESS_MANIFEST.json`, `business/`, application/workers, automation,
  migrations, and evidence have distinct existing roles. Change only the layer
  needed for the task and keep the GitHub repository authoritative for
  source-controlled policy, code, and approved/minimized evidence.
- Hosted D1 is the canonical runtime store for private operational records.
  Never copy customer PII, payment payloads, credentials, checkout capabilities,
  private support messages, or identity evidence into GitHub or an unapproved
  Drive folder. Generated local outbox files are not canonical customer records.

## Approval and external-action boundaries

- Preserve the existing owner gates for production, publication, spending,
  pricing, new customer categories, reports, and customer communication. A
  generated draft, passing test, or agent recommendation is not approval.
- Do not make a payment, refund, purchase, database mutation, source approval,
  publication, social post, or customer contact unless the existing approved
  control explicitly authorizes that exact action.
- Do not add or claim background operation. The existing GitHub Actions workflow
  is the only checked-in weekly report schedule; do not duplicate it. A schedule
  in source is not proof that a remote job ran successfully.
- Use Pages for the task/decision record and Google Drive for organized working
  copies when those integrations are actually available. Use PDF for an
  owner-approved customer deliverable and editable Presentations for a needed
  sales/training deck. If an integration or required format tool is unavailable,
  keep the GitHub source canonical, prepare only an allowed source-controlled
  draft, and report the external step as blocked. Never imply that a file was
  created or synced in an app that was not accessed.

## Reporting standard

For every task, distinguish implemented behavior from existing behavior, tests
from live/provider evidence, approvals from drafts, and blocked work from
completed work. Cite exact repository paths and verification commands. Do not
weaken a gate to make an example pass.
