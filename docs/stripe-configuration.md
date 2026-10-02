# Stripe integration: sandbox first

This is reviewable integration code, not evidence of a completed provider test or
approval to charge customers. It replaces the default Lemon Squeezy checkout path
with Stripe-hosted subscription Checkout and Billing Portal. Legacy code remains
only behind the explicit `PAYMENTS_PROVIDER=lemon_squeezy` compatibility setting.
No deployed Site, provider account, key, webhook registration or email setting was
changed by this patch. Preserve the already-working REPORT_SYNC_SECRET values.

## Safe defaults and owner setup

Keep `PAYMENTS_MODE=disabled`, `LIVE_CHECKOUT_VERIFIED=0`,
`PROVIDER_CAPACITY_VERIFIED=0` and `LIVE_DELIVERY=0` until each corresponding gate
has independently passed. Never paste secrets in chat, GitHub, documentation or
workflow inputs. The owner enters them in the existing customer Site's protected
server-side environment settings through the secure configuration flow.

For a separately approved sandbox rehearsal, use the existing **AdvantageOS
sandbox** account, not the shared test mode of the live account. All settings,
prices, webhook secrets and Portal configuration must come from the same sandbox.
Do not create another business system or another Stripe account.

Required customer Site runtime values:
- `PAYMENTS_PROVIDER=stripe`
- `PAYMENTS_MODE=test` only when the owner authorizes the sandbox rehearsal
- `PUBLIC_SITE_URL=https://local-opportunity-brief.mshipe2022.chatgpt.site`
- `STRIPE_API_KEY`: owner-configured restricted sandbox key, `rk_test_...` preferred
- `STRIPE_PRICE_ID`: active, fixed licensed $49 USD per month recurring Price
- `STRIPE_WEBHOOK_SECRET`: signing secret for the endpoint below
- `STRIPE_PORTAL_CONFIGURATION_ID`: the sandbox's explicitly reviewed Portal config

The code permits a server-side `sk_test_...` key for compatibility but recommends
a restricted key. No publishable browser key is needed for hosted redirects.
Neither Stripe key nor webhook signing secret belongs on the private owner proxy
Site or in GitHub. Existing OWNER_EMAIL, DB and sync settings stay in place.

Restricted-key capabilities to review in Stripe's current permissions UI:
- Create and retrieve Checkout Sessions
- Read Prices
- Read Subscriptions, including the expanded latest invoice
- Create Billing Portal Sessions with the specified configuration

Grant only the access required for these operations; validate exact permission
labels/dependencies with a sandbox request. This patch does not generate keys,
create OAuth grants, change provider permissions or claim those checks passed.
API/SDK are pinned to 2026-08-26.dahlia and stripe-node 22.6.0.

Review the Portal to allow payment-method maintenance and cancellation, and to
disable plan/quantity changes and unapproved upgrades/discounts. Review Stripe's
payment-method settings for the offer; code leaves dynamic payment methods on.
Tax registration, tax behavior and other public billing/legal decisions remain
launch gates. Automatic tax is not silently enabled.

## Signed webhook endpoint

Once reviewed code is deployed under separate authorization, register a snapshot
webhook on the same sandbox at:

https://local-opportunity-brief.mshipe2022.chatgpt.site/api/webhooks/stripe

The endpoint must be reachable by Stripe, without owner sign-in. Only its signed
raw body authenticates it. Select API version 2026-08-26.dahlia and these events:
- checkout.session.completed
- checkout.session.async_payment_succeeded
- checkout.session.async_payment_failed
- checkout.session.expired
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- customer.subscription.paused
- customer.subscription.resumed
- invoice.paid
- invoice.payment_failed
- invoice.payment_action_required

Provider registration and secret configuration need explicit owner authorization;
they have not been performed. Configure retries/observability in the existing
provider dashboard; a 2xx only follows successful local reconciliation, except
explicit unsupported/no-subscription no-ops.

## Owner sandbox flow

1. Sign in as OWNER_EMAIL on the customer Site's owner-only QA intake page.
2. Save or restore the matching synthetic owner-only intake. This creates no
   customer legal consent, service agreement or delivery authorization.
3. Choose **Sandbox checkout (fake money)** only after approving the test.
   `/api/owner/stripe-checkout` requires platform-authenticated owner identity and
   the saved QA record. Public customers cannot use this test-mode path.
4. Complete only Stripe's published sandbox payment method. A return-page notice
   is not payment proof. Wait for the signed event to reconcile `test_active`.
5. Open sandbox billing management for the same saved record. Verify cancellation,
   payment failure/recovery, asynchronous completion, duplicate events and
   out-of-order events against exact Site/database/provider evidence.
6. Return PAYMENTS_MODE to disabled when the authorized rehearsal ends if no
   further testing is approved. Disabling it also pauses webhook processing;
   retain the record and replay pending provider events when the same mode resumes.

QA rows stay `status=test`, with `test_` payment states and no delivery consent.
They cannot satisfy real customer delivery, first-delivery or market-history gates.
No test can silently set LIVE_CHECKOUT_VERIFIED or PROVIDER_CAPACITY_VERIFIED.

## Duplicate prevention and founding capacity

Each customer/mode has one persisted attempt, exact provider request and
idempotency key. Repeated calls reuse the same open Session. A lost response
replays the exact request before its fixed expiry; after that, it stops for owner
reconciliation rather than risking a second Session. No second subscription is
created for a record with billing history; use the Portal or support.

A Session expires at Stripe after about 31 minutes. The associated local hold
**does not expire by the local clock**. It is released only when Stripe confirms
that the matching Session expired, under the same per-customer checkout lease.
A webhook can recover a lost creation response using the exact persisted attempt
metadata. Unknown creates stay held until reconciled. Never delete their locks or
release their capacity merely because time passed.

A matched subscription awaiting payment occupies one `pending` place, not all
remaining places. Payment makes that place a lifetime `paid` founder allocation.
Pending failed/incomplete subscriptions require an owner capacity review; this
patch does not automatically cancel/refund/release subscriptions. Paid founder
places remain allocated after cancellation. Test/live capacity and new diagnostics
are isolated. Historical diagnostics with unknown mode remain fail-closed.

Per-subscription leases, authoritative subscription retrieval and transactional
event-ID dedupe handle retries, equal timestamps and out-of-order delivery.
Provider failures leave events retryable. No raw billing payload or customer
capability token is stored in the event audit, or sent in Stripe metadata.

## Cancellation and report scheduling

The existing customer terms say reports stop when cancellation is recorded.
Accordingly, `cancel_at_period_end` or `cancel_at` stops future live report
scheduling immediately (`status=canceled`). Stripe's subscription status and paid
period remain provider truth; this integration does not change billing dates.
An active provider status or later invoice success never silently resumes a
canceled/paused report customer. Resumption requires the existing explicit owner
action. Definite cancellation and offer-shape changes revoke report eligibility.

## Remaining launch evidence

A real sandbox Checkout-to-webhook-to-Portal round trip is **not verified** by
mocked tests. Neither are Stripe account readiness, key permissions, endpoint
reachability, sender verification, owner inbox receipt or customer launch.
Read [email-configuration.md](email-configuration.md) for the existing Resend path.

No merge, deployment, live payment, customer email or public-launch action is
implied by this patch. Before launch, review exact tested commit, provider receipts,
capacity behavior, approved price/tax/cancellation configuration, customer gates,
and the owner's final authorization.

Official implementation references:
- [Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create)
- [Webhook signatures, duplicate events and ordering](https://docs.stripe.com/webhooks)
- [Subscription lifecycle](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Billing Portal sessions](https://docs.stripe.com/api/customer_portal/sessions/create)
- [Sandbox isolation](https://docs.stripe.com/sandboxes)
- [Restricted keys](https://docs.stripe.com/keys)
