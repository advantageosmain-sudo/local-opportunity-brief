# Capability build — task and decision record

**Record date:** 2026-10-04 (UTC)
**Business:** Local Opportunity Brief
**Requested priority:** Product Readiness, Digital Product Production, Business
Records
**Status:** Repository implementation complete; external app work and production
release remain blocked.

> **Pages/Drive handoff:** This is the canonical GitHub Markdown record. Pages and
> Google Drive are not connected to the current tool surface, so no native Pages
> page or Drive file was created or synced. This document is ready to copy into a
> Pages decision record once the integration is available. GitHub remains the
> source of truth.

## Task

Inspect the existing catalog first, then add the highest-value missing
instructions and specialized agents for the business without duplicating its
application, report pipeline, approval controls, records store, or schedule.

## Decisions

| Decision | Rationale / constraint |
| --- | --- |
| Scope is the one business in `BUSINESS_MANIFEST.json`. | No other business is represented in the manifest; examples and planning notes do not create additional businesses or customers. |
| Add Codex repo skills under `.agents/skills/` and project custom agents under `.codex/agents/`. | The repo had no skill or custom-agent catalog. This uses the supported local authoring layout without introducing a runtime service. |
| Reuse readiness, research, product, delivery, and records logic already in the repository. | Existing launch checklist, source gates, immutable report packets, approval controls, D1, retention policy, and read-only policy planner remain authoritative. |
| Keep readiness and records agents read-only; restrict product production to an isolated draft area. | Agents can identify evidence gaps, not approve launch, mutate records, issue money, publish, send messages, or overwrite canonical product data. |
| Require explicit production approval separate from publication and customer communication. | An approved report or a passing test is not automatically permission to create every derivative, publish it, or contact a customer. |
| Do not add a new scheduler or worker. | `.github/workflows/weekly-brief.yml` already defines the Monday process. This task does not duplicate it or claim a remote execution. |
| Do not generate a customer PDF or sales/training deck in this change. | No exact production approval was requested, the current verified owner packet is still a TEST/owner-review artifact, and Pages/Drive/Presentations integrations are unavailable. |

## Implemented

- Repository-wide `AGENTS.md` guardrails for business scope, architecture,
  source-of-truth, approvals, external surfaces, and reporting.
- Three reusable skills with inputs, workflow, permissions, verification
  examples, and copyable invocation prompts:
  - `.agents/skills/product-readiness/SKILL.md`
  - `.agents/skills/digital-product-production/SKILL.md`
  - `.agents/skills/business-records/SKILL.md`
- Three Codex custom-agent profiles:
  - `.codex/agents/product-readiness.toml` (read-only)
  - `.codex/agents/digital-product-producer.toml` (draft-only workspace-write)
  - `.codex/agents/business-records-steward.toml` (read-only)
- Existing-vs-missing capability inventory in `docs/CAPABILITY_CATALOG.md`.
- A deterministic local validator and test for skill/agent completeness.

No production application, database, payment/delivery route, source data, policy,
owner approval, or GitHub schedule was changed. No customer-facing output was
produced.

## Google Drive working-file organization (proposed, not created)

When Drive is available, organize noncanonical working copies under:

```text
Local Opportunity Brief/
  00-Operations/Decision Records/
  10-Product/Readiness/
  20-Production/Drafts/YYYY-MM/
  30-Records/Indexes/
```

Keep canonical code, policies, approvals and minimized evidence in GitHub; keep
private customer and payment records in their existing protected runtime. Add
links/checksums to the GitHub record rather than duplicating private payloads.
There is no automatic synchronization configured by this change.

## Verification example and safe outcome

A request to make a customer PDF from
`owner-test-olympia-future-2026-10-03` must be blocked: it is a TEST profile, and
the exact packet still requires the matching authenticated dashboard decision.
The source/currentness check must be repeated at production time. This prevents a
valid-looking internal artifact or prior chat approval from becoming a customer
release. The PDF and editable deck paths are instructions for future authorized
work, not a claim that those formats were generated or independently verified.

## Verification performed

- `npm run capabilities:check` — passed; all 3 skills and 3 agents are paired and
  the manifest scope is Local Opportunity Brief.
- `node --test tests/capability-catalog.test.mjs` — passed, 1/1.
- `python3` `tomllib` parse — all 3 custom-agent TOML files parsed and their
  sandbox modes matched the intended read/write boundaries.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — passed: production artifact build/validation and 803/803 tests.
  Provider behavior in the suite uses mocked/synthetic boundaries; this is not
  live provider or customer evidence.
- `git diff --check` — passed. No PDF file is present or claimed as produced.
- No live provider request, hosted database, real customer/payment, PDF renderer,
  presentation app, Pages, or Drive operation was invoked. The full test suite's
  provider/payment cases used mocked or synthetic boundaries only.

## Blockers and owner decisions

1. **Pages / Drive / Presentations:** no connectors or authenticated app tools are
   exposed in this session. Native Pages records, Drive organization/sync, and
   editable Presentation creation remain blocked until those apps are connected.
2. **Customer PDF:** no new final customer asset is authorized or produced. Use
   only a current, eligible, exact-checksum report with explicit production
   approval; publication and communication need their own approvals.
3. **Product-readiness status:** no business, market, legal, provider, customer
   demand, or launch decision is changed by adding these workflows.
4. **Business records operations:** the policy planner remains non-mutating and
   is not wired to an authenticated operational queue. Database migration,
   identity verification, export, refund, and deletion remain separate reviewed
   work.
5. **Agent runtime:** TOML/skill files are checked in for a compatible Codex
   environment; this Agent Mode task did not spawn those custom agents or verify
   their runtime discovery.
6. **Background operation:** no worker or schedule was added. The existing
   workflow is visible in source, but its remote status/execution was not checked
   by this task.

**Approval state:** This record grants no production, publication, spending,
customer-communication, database, or live-provider permission.
