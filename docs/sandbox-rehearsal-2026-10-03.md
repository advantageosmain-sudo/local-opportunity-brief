# Sandbox rehearsal and webhook diagnostics

## Observed provider-backed rehearsal

On October 3, 2026, the existing owner-only QA Checkout completed a simulated
$49 USD monthly subscription in Local Opportunity Brief Sandbox. Checkout,
invoice and subscription all returned `livemode: false`. Only synthetic billing
details and Stripe's documented test card were used; Link saving was unchecked.

The signed `invoice.paid`, `customer.subscription.created`, and
`checkout.session.completed` deliveries were recorded exactly once each. The QA
record became `test_active`, remained `status=test`, and retained false delivery
consent. The owner dashboard showed `SANDBOX_PAYMENT_CONFIRMED`; live customer
and subscription totals stayed zero.

The existing owner-only Portal action opened the same sandbox customer and
subscription. Its cancellation configuration canceled immediately. Stripe then
reported the subscription canceled, and the signed
`customer.subscription.deleted` delivery changed the QA record to
`test_canceled`. The paid founding reservation and billing history were retained.
The Portal return link returned to the owner QA page.

Evidence identifiers:
- Subscription: `sub_1UMHeaHIBIrkXtd8igrNEmwg`
- Invoice: `in_1UMHeYHIBIrkXtd82LTzbCsW`, number `O4NE2OKE-0001`
- Cancellation event: `evt_1UMHkGHIBIrkXtd8VBrHfbys`, received 01:28:13 UTC

Runtime remained test-only with `LIVE_DELIVERY=0`, `LIVE_CHECKOUT_VERIFIED=0`,
and `PROVIDER_CAPACITY_VERIFIED=0`. No delivery attempts were created.

## Initial webhook 503s: evidence and limits

At approximately 01:22:23 UTC, three concurrent deliveries arrived. The invoice
delivery succeeded while the subscription and Checkout deliveries returned 503.
Their retries succeeded at 01:22:38 and 01:22:40 UTC. The original logs expose
status and request IDs, but not the inner errors. Lock contention is consistent
with this pattern; it is not a proven historical diagnosis. Database setup,
provider reads, transactional writes and lease cleanup can also fail.

The patch preserves lock ownership, authoritative provider-state retrieval,
atomic event deduplication and non-2xx retries. It adds typed lock-busy/expired
codes and structured diagnostics after signature verification. Logs identify
database initialization versus reconciliation, HTTP status, fixed error
category, verified event ID/type/mode and a validated provider request ID when
available. They exclude payloads, signatures, credentials, personal details,
raw messages, stacks and hosted-session URLs. Logging failures do not change
the response. Cleanup failures still fall into reconciliation; no historical
cause is inferred from the new categories.

## Additional regression coverage

Offline tests exercise three simultaneous events and safe retries, expired
lease takeover, ownership checks and token-safe release, signed supported-event failure/recovery and
cancellation, delayed/duplicate events, Portal mapping, immutable QA restore,
diagnostic redaction and transactional rollback. Delivery tests use an
intercepted mock provider, including test-active/corrupted QA records and a QA
flag or consent change immediately before the atomic claim. The final claim
now rechecks the QA flag as well as consent and payment state.

Renewal and failed-payment lifecycle transitions are verified with synthetic
signed events and mocked authoritative Stripe responses. They are not a real
provider-clock renewal rehearsal. The retained subscription is canceled and
cannot renew. A provider-driven renewal test needs a separately scoped test
subscription/clock plan; do not recreate billing or attach a persistent test
clock to retained evidence implicitly. Actual customer email delivery remains
untested and disabled. These results do not authorize a live launch.
