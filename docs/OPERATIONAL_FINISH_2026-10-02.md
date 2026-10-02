# Local Opportunity Brief operational finish

Fresh baseline is `evidence/baseline-2026-10-02.json`. Canonical price remains $49/month for the first ten accepted businesses; $79 is not activated.

## Implemented controls
- Intake validation, consent, US states/ZIP, durable idempotent customer/market creation and bounded attempts
- Test/live Lemon Squeezy adapter gated off until provider eligibility/configuration tests exist; subscription product binding, signed events, duplicate/stale suppression, sticky owner pause/cancel
- Customer source registry import and owner market review. A new city needs a source pack, not code changes. Automatic discovery is **not yet implemented**; unsupported coverage must block checkout
- Protected customer export, report sync, durable email claim, unknown-outcome lock, accepted vs delivered receipts, provider readback and suppression
- First-customer/market owner review; full report preview and exact checksum approval. Automation secret cannot approve
- Private owner snapshot surface and authenticated backend controls
- Chicago Monday schedule and failure diagnostics

## External blockers / do not claim live
No authenticated Lemon Squeezy or Resend account has yet been verified. Stripe connector requires reconnection. There are no verified live product/price/webhook/sender credentials or test receipts. Do not enable `LIVE_CHECKOUT_VERIFIED` based solely on code tests. Provider account identity/tax/bank/legal actions remain owner-controlled.

The existing owner surface uses a server-side automation token for its snapshot; its UI is read-only, but this is not a separately scoped read-only credential. A dedicated scoped credential is a future least-privilege improvement requiring secure configuration. Never expose it in browser JS.

The historical PR #2 DeWitt packets contain elapsed events and stay preserved in their original branch; they are not current launch evidence. Current Olympia owner test is a new dated packet.

## Rollback
Set `LIVE_DELIVERY=0` and `PAYMENTS_MODE=disabled` to stop new outward operations, retain data and receipts, then restore the previous tested Site version if necessary. Never delete customers/reports or retry unknown sends as rollback. Canceling report service is separate from provider subscription cancellation.

Cancellation copy is aligned with the October 2 execution instruction: recorded cancellation stops future scheduled reports. No existing paying customers or grandfathered entitlement was established during this audit; if later evidence establishes one, preserve that customer's original terms rather than retroactively replacing them.

Before live checkout, verify provider-side ten-member inventory/checkout capacity: the app's count check is not an atomic reservation and cannot stop reuse of a provider link. Live eligibility must remain disabled until this provider-side limit and exact $49 recurring price are verified. This is a launch blocker, not a claimed completed capacity control.
