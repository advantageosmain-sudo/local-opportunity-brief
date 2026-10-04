# Existing capability catalog and prioritized gaps

**Inventory date:** 2026-10-04 (UTC)
**Scope:** the checked-in `BUSINESS_MANIFEST.json` describes one business: Local
Opportunity Brief, currently in founding validation. This catalog does not infer
additional businesses from examples, owner QA, or planning notes.

## What already exists

| Area | Existing canonical capability | Status / boundary | Reuse decision |
| --- | --- | --- | --- |
| Product readiness | `business/LAUNCH_CHECKLIST.md`, `business/TECHNICAL_READINESS.md`, `business/APPROVAL_POLICY.md`, dated records under `docs/` and `business/evidence/` | Multiple readiness dimensions and approval gates exist. A green code test is not customer, legal, provider, or launch approval. | Add a read-only readiness reviewer that synthesizes the existing evidence; do not create a duplicate checklist or launch gate. |
| Report product | `automation/lib/engine.mjs`, `automation/lib/run-customer.mjs`, report JSON/Markdown, research/report validation, checksum, approval packet and existing weekly workflow | The existing pipeline prepares immutable, owner-reviewable briefs and may request hosted delivery only through existing authorization. | Keep it the canonical product generator. Do not fork research, content, validation, approval, or delivery logic. |
| Delivery presentation | `lib/delivery-presentation.mjs` | Renders an approval-aware Markdown delivery view. It is not a PDF exporter or an editable slide-deck generator. | Reuse its exact-approval and immutable-source principles; do not call it a PDF/deck capability. |
| Research and sources | `business/SOURCE_POLICY.md`, `automation/lib/source-validation.mjs`, `lib/source-review.mjs`, `/dashboard/source-review`, existing source-ingestion and report tests | Candidate ingestion is not source verification; owner approval, freshness, market match, five-opportunity coverage, and report gates remain separate. | Invoke the existing review and validation flow; do not add a second browsing or approval agent. |
| Business records | `business/DATA_RETENTION.md`, `docs/POLICY_OPERATIONS_PREPARATION_2026-10-04.md`, `lib/policy-operations.mjs`, hosted D1 records, versioned evidence, ignored `automation/outbox/` | The planner is read-only, is not imported by an application route, and cannot execute refunds/deletion. D1 is the private runtime store; GitHub evidence is intentionally minimized. | Add a records steward that locates, classifies, and reports gaps without creating a parallel store or altering records. |
| Skills and agent profiles | No repo-local `.agents/skills/` or `.codex/agents/` catalog existed in the inspected tree. | Existing code and procedures are capabilities, but lack focused, reusable instructions and role boundaries. | Add three Codex skills and three project-scoped custom agent profiles, all mapped to the existing system. |
| Customer formats | Weekly packets include JSON, Markdown, email preview, validation and evidence. The checked-in tree contains no verified customer PDF or editable sales/training deck production path. | Existing sample and owner-QA materials are not current, customer-approved deliverables. | Specify a gated production workflow; do not create a PDF, deck, or renderer from test data without owner authorization. |

## Highest-value missing capabilities implemented here

1. **Product Readiness** — `.agents/skills/product-readiness/SKILL.md` and
   `.codex/agents/product-readiness.toml`. A read-only, evidence-linked readiness
   review that distinguishes tests, sandbox evidence, customer proof, external
   facts, and owner decisions.
2. **Digital Product Production** —
   `.agents/skills/digital-product-production/SKILL.md` and
   `.codex/agents/digital-product-producer.toml`. A source- and checksum-pinned
   production workflow for approved PDFs and editable sales/training decks,
   reusing the existing report pipeline and keeping production separate from
   publication and customer communication.
3. **Business Records** — `.agents/skills/business-records/SKILL.md` and
   `.codex/agents/business-records-steward.toml`. A data-minimized record
   classification/reconciliation workflow that respects GitHub, hosted D1,
   evidence, local outbox, and retention boundaries.

These are reusable instructions and agent profiles, not newly deployed business
services. No app route, database schema, report generator, payment/delivery path,
or business policy was replaced or bypassed.

## Working-surface and source-of-truth contract

- **GitHub:** canonical versioned source for code, policies, this catalog, agent
  instructions, and approved/minimized evidence. Do not move source-of-truth
  content into an untracked Drive copy.
- **Hosted D1:** canonical runtime location for private customer and operational
  records. Do not export its private payload into this repository or general
  Drive folders.
- **Pages:** intended surface for a task/decision record when connected; preserve
  a GitHub source or exact GitHub reference as authoritative. This task's record
  is `docs/agent-capability-build-2026-10-04.md` (Markdown, not a Pages document).
- **Google Drive:** intended location for organized, noncanonical working files
  when connected. Suggested business-scoped folders are
  `Local Opportunity Brief/00-Operations/Decision Records`,
  `10-Product/Readiness`, `20-Production/Drafts/YYYY-MM`, and
  `30-Records/Indexes`. Keep only approved, minimized material there; no secrets,
  customer payloads, payment data, identity evidence, or automatic sync.
- **PDF:** use only for a final, owner-authorized customer deliverable from an
  eligible, current, exact-checksum product source. Verify the exported content;
  PDF creation does not authorize sending or publication.
- **Presentations:** use an editable presentation only when a sales or training
  deck is needed. The editable source, source citations, factual limits, and
  separate owner release decision must be preserved.

## Execution and permission status

The existing Monday GitHub Actions workflow remains the only checked-in weekly
schedule. This build adds no scheduler or worker and does not assert that a remote
scheduled run was executed. Product production, public publication, spending,
pricing, report approval, live payments, outbound email, and customer
communication remain behind their existing owner gates.
