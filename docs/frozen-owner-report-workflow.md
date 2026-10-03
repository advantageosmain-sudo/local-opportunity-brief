# Frozen owner report operations

This manual workflow defaults to report synchronization only. It does not create billing, approve reports, change Site settings, or dispatch itself. Real owner email requires an independently authorized send and the Site's tightly pinned, default-off rehearsal gate. Customer `LIVE_DELIVERY` stays `0`.

## Dispatch inputs

- `operation`: `sync` (default), `owner_rehearsal_send`, or `owner_rehearsal_reconcile`.
- `report_id`: exact frozen ID, restricted to `owner-test-…-YYYY-MM-DD`.
- `expected_checksum`: exact lowercase 64-character report SHA-256.
- `expected_recipient`: exact owner email, required for send/reconcile; not used by sync.

Inputs enter the process as environment values, never shell fragments. There is no caller-selected path. The helper reads only `evidence/<report_id>/dashboard-sync.json` from the checked-out revision, rejects symlink evidence paths, and accepts at most 500,000 bytes of UTF-8 JSON. No dependency installation is required.

Current prepared packet:

- Report ID: `owner-test-olympia-future-2026-10-03`
- SHA-256: `0d1635457fbe814edbf4e374edffe7978a1629a968fdaedd31929889b923a408`

These values identify the prepared report, not automatic permission to send it. Its exact checksum must still match, and current validation must pass when synchronizing or sending. This packet's seven-day age gate expires after October 10, 2026 00:00 UTC; preparation dates favor review before October 7. Source changes can invalidate it sooner.

## Existing configuration

GitHub retains the existing `REPORT_SYNC_URL` variable and `REPORT_SYNC_SECRET` secret. The URL must be HTTPS with the exact `/api/internal/reports` path and no embedded credentials, query or fragment. The secret is passed only as the hosted bearer credential; it is never printed, copied into inputs, included in artifacts, or sent directly to Stripe/Resend.

For an explicitly authorized owner send, the Site implementation must already be deployed with these exact protected runtime pins:

- `OWNER_REHEARSAL_ENABLED=1` temporarily enables the owner-only send gate.
- `OWNER_REHEARSAL_REPORT_ID` equals the requested report ID.
- `OWNER_REHEARSAL_CHECKSUM` equals the requested checksum.
- `OWNER_REHEARSAL_RECIPIENT` equals the requested recipient and existing `OWNER_EMAIL`.
- Existing provider credentials and a permitted sender are securely configured through the separate approved setup.

Do not set `LIVE_DELIVERY=1` for this rehearsal. Missing/mismatched pins or owner approval must fail closed. These settings are not created or changed by the workflow.

## Three separate operations

1. `sync` validates current immutable owner-only contents and posts those exact read bytes to `/api/internal/reports`. It requires `PENDING_APPROVAL`, non-fixture data, `owner_review_only`, `deliveryEligible=false`, `liveDelivery=false`, and required owner review. Forged delivery receipts are rejected. Success confirms only `SAVED` or `ALREADY_SAVED` for the requested ID. It never follows with approval or delivery.
2. The authenticated owner reviews the hosted report and records the exact approval. Then, only with specific send authorization and the narrow Site gate configured, a separate `owner_rehearsal_send` dispatch posts `{reportId, checksum, expectedRecipient}` to `/api/internal/automation/deliver`. Existing exact approval, recipient pins and durable duplicate/uncertain-send claims remain authoritative. `ACCEPTED` and a provider ID are not confirmed delivery or inbox arrival.
3. `owner_rehearsal_reconcile` posts the same exact selector to `/api/internal/automation/reconcile-delivery`. The backend must select only the existing matching owner attempt and reject absent/mismatched attempts without falling back to a batch. This operation verifies the frozen identity but permits time-expired research, so an accepted email can be checked after new sends are disabled. Keep identity/recipient pins available while disabling `OWNER_REHEARSAL_ENABLED`. A valid result must echo the exact report ID/hash, exactly one checked attempt, and allowlisted durable `deliveryStatus` and provider `receiptEvent`. `deliveryStatus=delivered` identifies verified durable delivery even if `confirmed=0` because delivery was recorded earlier; `accepted` remains pending and `failed` is a failure. Never infer delivery from counters alone. No resend or lock clearing occurs.

Each helper invocation makes at most one HTTP request. Redirects are rejected, provider/transport bodies are not logged, and no automatic retry occurs. An uncertain result needs inspection of the hosted durable state before any further action. A manual retry of sync may return `ALREADY_SAVED`; that idempotent sync behavior does not authorize retrying an uncertain email send.

## Offline checks

Run:

`node --test automation/tests/frozen-owner-sync.test.mjs`

The suite covers exact bytes/identity, bad paths, symlinks, malformed/oversized input, checksum changes, fixture/customer-mode/delivery/approval guards, stale reports/sources, safe endpoint configuration, explicit owner transport contracts, precise receipt counters, single-request behavior and redacted errors. It uses synthetic intercepted HTTP only. It does not prove provider delivery, deployed owner authentication or Site gate configuration.
