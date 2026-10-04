---
name: digital-product-production
description: Turn an existing, validated and explicitly owner-authorized business product into a customer PDF or an editable sales/training presentation while preserving the original source, facts, approvals, and brand.
---

# Digital Product Production

## When to use

Use this workflow when a specific digital product or customer-facing asset must
be produced from an existing business source: a weekly customer brief, a sample
PDF, an editable sales deck, or an editable training deck. Do not use it to
research new opportunities, decide product readiness, approve a report, email a
customer, or publish an asset; hand those questions to the existing source and
approval workflows.

## Existing product architecture to reuse

For Local Opportunity Brief, the canonical product is created by
`automation/lib/engine.mjs` and `automation/lib/run-customer.mjs`. Reuse the
immutable `report.json`, its checksum, source snapshot, research validation,
report validation, warnings, and existing owner approval/delivery controls.
`lib/delivery-presentation.mjs` renders an approval-aware Markdown delivery
view; it is **not** a PDF generator or a slide-deck generator. Use
`business/BRAND.md`, `business/SOURCE_POLICY.md`, and
`business/APPROVAL_POLICY.md` for voice, evidence, and gates. Never fork the
business logic into a new report generator or use a mutable email preview as the
source of truth.

## Format and production workflow

1. **Identify the deliverable.** Record the business, audience, format, purpose,
   requested production date, exact input artifact and checksum, and whether the
   request is a draft or a final production request. A weekly customer brief is
   a candidate for a PDF. Use an editable Google Presentation (or editable
   `.pptx` if that is the available approved tool) only when a sales or training
   deck is actually needed. Keep a task/decision record in Pages when connected.
2. **Verify the source.** Read the canonical source artifact, report status,
   validation, source dates, currentness, warnings, business profile, and the
   exact owner decision. Exclude demo/sample/QA records from customer output.
   Do not reuse an expired report or rewrite its original facts to make the
   design work. Keep the input checksum visible in the production record.
3. **Check the production gate.** Require an explicit owner authorization for
   final production of the specified asset, tied to the business, content/version,
   audience, and output. An exact report approval is not automatically approval
   to create every derivative. A draft may be made only when explicitly
   requested, is marked `DRAFT — NOT APPROVED`, and cannot be handed to customers.
   Publication, posting, sending, pricing, spending, and customer communication
   remain separate gates.
4. **Use the requested working surfaces.** If available, keep working files in
   the approved Google Drive business folder, the task/decision record in Pages,
   customer deliverables as PDF, and sales/training decks in editable
   Presentations. Treat Drive and Pages as working surfaces, not replacements
   for GitHub or hosted runtime truth. If the integration is unavailable, do not
   simulate a sync or claim a Pages/Drive/Presentations write; report that step
   as blocked and retain only an allowed source-controlled draft.
5. **Preserve the source.** Write to a new versioned output path. Never overwrite
   a report, evidence pack, approved copy, or prior export. A derivative must
   retain the source report ID/checksum and relevant source links, dates,
   confidence, limitations, and warnings. Do not add unsupported outcomes,
   testimonials, logos, endorsements, discounts, inventory, or guarantees.
6. **Verify the file.** For a PDF, check page count, extracted text, links, dates,
   readable layout, and that no draft/internal data leaked. For a presentation,
   confirm it remains editable and inspect every slide for source citations,
   accurate claims, useful contrast, and no invented proof. Record the output
   checksum and verification method. Escalate any mismatch rather than silently
   correcting approved source content.
7. **Stop before release.** Return the artifact and QA record for owner review.
   Do not send, publish, upload to a public URL, or launch an automation. A final
   output is not a customer communication receipt.

## Permission boundaries

The production agent may prepare a non-customer-facing draft only when asked and
only in the designated working area. It cannot approve production, publication,
source evidence, reports, customer claims, provider changes, spending, outbound
email, social posts, or terms. It cannot edit the canonical report, business
manifest, owner approval ledger, hosted D1 data, or existing scheduler. Do not
copy private customer, payment, recipient, support, identity, or credential data
to Drive, a PDF, a deck, or GitHub. Stop when authorization or a required tool is
missing.

## Verification example

**Request:** “Export `owner-test-olympia-future-2026-10-03` as a customer PDF.”

**Correct result:** `BLOCKED — DO NOT PRODUCE A CUSTOMER PDF`. The recorded source
is an owner-only TEST profile and the report packet remains pending the matching
authenticated dashboard decision; its historical chat approval is not a durable
customer release. Its event/source facts also require a freshness/currentness
check at production time. The agent must not re-label it as a customer report,
produce or publish a final PDF, or send it. It should name the missing exact
owner authorization and current validation. No PDF is emitted in this example.

## Invocation prompt

> Use digital-product-production for **[business]**. Prepare **[PDF customer
> deliverable / editable sales deck / editable training deck]** from **[exact
> source path and ID]**, checksum **[sha256]**, for **[audience]**. Production
> approval: **[exact owner decision reference or “not provided”]**. Publication
> or customer communication: **[none / separately approved reference]**. Verify
> freshness and source eligibility first; if any gate or Pages/Drive/Presentation
> integration is unavailable, stop, report the blocker, and do not claim the
> external file was created or synced.
