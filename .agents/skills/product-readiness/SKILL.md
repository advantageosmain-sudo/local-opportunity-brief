---
name: product-readiness
description: Review whether an existing business, product, launch, market, or customer promise is ready by reusing its manifest, policy, code, tests, and dated evidence; produce an evidence-linked readiness decision without approving or publishing anything.
---

# Product Readiness

## When to use

Use this skill to assess a product, market, offer, launch, operating change, or
customer promise against the business's actual architecture and evidence. Use it
before changing a readiness claim, producing a final customer-facing asset, or
asking an owner to make a launch decision. Do not use it as a substitute for
legal, tax, provider, market-demand, or owner approval.

## Source inventory and reuse

Start with `BUSINESS_MANIFEST.json` to establish business scope. For Local
Opportunity Brief, reuse rather than replace:

- `business/LAUNCH_CHECKLIST.md`, `business/TECHNICAL_READINESS.md`,
  `business/APPROVAL_POLICY.md`, and `business/SOURCE_POLICY.md` for existing
  product, launch, evidence, and permission gates.
- `docs/TECHNICAL_READINESS_2026-10-03.md`,
  `docs/POLICY_OPERATIONS_PREPARATION_2026-10-04.md`, and dated evidence for the
  latest recorded state. Check the date and status in every evidence item; a
  historical or test result is not current/live proof.
- `automation/lib/source-validation.mjs`, `lib/source-review.mjs`,
  `lib/policy-operations.mjs`, the existing report engine, and their tests for
  implemented checks. Do not add a second validator or approval queue.
- The existing Monday GitHub Actions report workflow. Do not add another
  scheduler or describe a configured workflow as a successful run without
  execution evidence.

## Workflow

1. **Fix the scope.** Name the business and requested decision. Read its current
   manifest and relevant architecture/policy files. If the requested business
   or market is not represented, say so; do not create it from a sample.
2. **Trace each claim.** Build a compact matrix with claim, repository source,
   evidence date, evidence type (code/test, synthetic, sandbox, provider, owner,
   or customer), current status, and missing proof. Prefer exact file paths,
   checksums, test IDs, and report IDs over summaries.
3. **Check freshness and applicability.** Separate test fixtures and owner QA
   from real customer evidence. Confirm that source dates, report dates, market,
   business profile, provider mode, and relevant approvals match the decision.
   A passing unit test proves only the tested code path.
4. **Verify safely.** Run focused local tests or static checks that do not call
   providers, alter runtime state, send messages, or spend money. Do not run the
   weekly job against hosted customer data merely to make a readiness claim.
5. **Return a decision record.** Use `PASS`, `BLOCKED`, `OWNER DECISION`, and
   `NOT VERIFIED` precisely. List evidence, gaps, the smallest next action, the
   owner who must decide, and which existing approval gate remains. Pages is the
   requested task/decision surface when available; the repository Markdown
   record remains canonical. Never flip a checklist or public status on behalf
   of the owner.

## Expected output

Provide a short evidence matrix, a clear overall status, exact next owner
questions, safe verification performed, and any external dependencies. Avoid a
single green “ready” label if any product, legal, payment, source, customer,
security, or publication gate remains open.

## Permission boundaries

Default to read-only. You may draft a clearly labeled internal recommendation
when explicitly requested, but do not change business policies, launch
checklists, pricing, product promises, report approval records, source status,
customer records, database state, deployment settings, or public copy. Do not
contact customers, configure providers, spend money, publish, or schedule
background work. Escalate decisions to the owner; an approval in one area does
not authorize another.

## Verification example

**Request:** “Is the proposed Benton pilot ready for paying boutiques?”

**Correct result:** `BLOCKED / NOT VERIFIED`. The current manifest is for Local
Opportunity Brief in founding validation; the checked-in sample/source evidence
is Olympia-specific, and the policy preparation record says Benton is a planned
market while the actual business is still pending. The agent must not create a
Benton customer/market record or mark a launch item complete. It should request
current first-party Benton sources, a named weekly operator, real-customer
feedback, and the outstanding owner/legal/provider decisions, while citing the
existing source-onboarding and launch gates. No report or customer message is
sent.

## Invocation prompt

> Use the product-readiness skill for **[business]**. Assess **[specific offer,
> market, launch, or change]** as of **[date]**. Read the existing manifest,
> policies, implementation, tests, and dated evidence before proposing anything.
> Return an evidence-linked PASS/BLOCKED/OWNER DECISION/NOT VERIFIED matrix,
> state exactly what was tested, preserve all approval gates, and do not modify
> the business or take external action.
