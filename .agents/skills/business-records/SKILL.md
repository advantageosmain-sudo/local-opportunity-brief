---
name: business-records
description: Classify, index, and reconcile business records against their true system of record and retention policy without copying private data, changing timestamps, or executing deletion or refund actions.
---

# Business Records

## When to use

Use this workflow to find where a business record belongs, build a minimal
records index, reconcile an evidence reference, or identify a retention/decision
anchor that needs owner review. Do not use it to make a refund, retention,
identity, legal, deletion, customer-response, or accounting decision.

## Existing record architecture to reuse

For Local Opportunity Brief:

- `BUSINESS_MANIFEST.json`, `business/`, application/automation source, and
  approved/minimized evidence in GitHub are the source of truth for versioned
  policies, implementation, samples, and evidence snapshots.
- Hosted D1 is the canonical runtime store for private leads, customer profiles,
  reports, owner decisions, payment/delivery state, and audit records. Do not
  reconstruct these records from Git history or place their PII in this repo.
- Generated `automation/outbox/` packets are ignored working output; they are
  not the customer database or a permanent business ledger.
- `business/DATA_RETENTION.md` contains current retention policy. The read-only
  planner in `lib/policy-operations.mjs` and the preparation notes in
  `docs/POLICY_OPERATIONS_PREPARATION_2026-10-04.md` identify review logic and
  unimplemented integration gaps. The planner cannot approve or delete.

## Workflow

1. **Identify record class and purpose.** Determine whether the request concerns
   policy/code, public research evidence, an internal working file, a customer or
   payment record, an owner decision, or a generated report. Record only the
   minimum metadata needed to locate it.
2. **Find the canonical system.** Use the map above and cite the exact path,
   stable ID, report ID, or checksum. Distinguish a private runtime record from a
   version-controlled policy or an ephemeral output. Never create a competing
   record store.
3. **Build a minimized index if requested.** Allowed fields: record class,
   opaque reference/ID, canonical system and location, source checksum/version,
   status, relevant date and time-zone basis, policy reference, reviewer, and
   next review action. Do not copy record payloads or free-text customer notes.
4. **Check anchors, don't infer them.** Use the event explicitly named by the
   applicable policy (for example, final decision, verified cancellation,
   original receipt, delivery, or diagnostic resolution). Mark absent evidence
   `missing_anchor`. Never substitute `updated_at`, report generation time,
   checkout time, or a guessed business date. Preserve holds and the original
   maximum; a review date is not deletion authority.
5. **Organize working files without changing authority.** When available, use
   Google Drive for noncanonical working copies in a business-scoped hierarchy
   such as `Local Opportunity Brief/00-Operations/Decision Records`,
   `10-Product/Readiness`, `20-Production/Drafts/YYYY-MM`, and
   `30-Records/Indexes`. Pages may hold the task/decision record. Keep links and
   checksums in the GitHub record; do not create an automatic sync. No secrets,
   customer payloads, payment data, or identity evidence belong in the Drive
   working area.
6. **Report findings only.** Summarize missing anchors, duplicates, stale links,
   and policy mismatches for the owner. Any correction, migration, export,
   retention extension, refund, customer reply, or deletion requires its own
   reviewed authorization and existing approved workflow.

## Permission boundaries

Default to read-only and data-minimized. Do not mutate D1, create a migration,
change an audit row, backdate a timestamp, approve a request, contact a customer,
issue money, export a customer file, extend a hold, or delete any copy. Do not
put private records in GitHub Pages/Drive or include them in a general report.
An owner review plan is a prompt for a human decision, never an action command.

## Verification example

**Request:** “Find the retention deadline for an old unaccepted founding lead.”

**Correct result:** If the immutable final-decision time cannot be verified, return
`missing_anchor`, cite the current retention rule and the record location without
exposing the lead's PII, and ask the owner for the authoritative decision event.
Do not use the row's mutable `updated_at`, assign migration time, calculate a
made-up deadline, or delete the record. The existing read-only planner also
returns `missing_anchor` when `finalDecisionAt` is absent.

## Invocation prompt

> Use business-records for **[business]**. Locate/index/reconcile **[record class
> or exact opaque reference]** for **[purpose]**. Use the existing policy and
> system-of-record map, return only minimal metadata and source references, mark
> unverifiable dates as `missing_anchor`, and list any owner decision required.
> Do not modify a database, copy PII, send a message, issue money, change
> retention, or delete records.
