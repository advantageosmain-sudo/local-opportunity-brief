# Owner test setup — zero to a protected rehearsal

Do not switch any provider to live mode. Do not use a real customer email or
real card details during this setup.

## 1. Confirm the repository first

1. Open the repository in GitHub.
2. Open **Actions**.
3. Open **Validate business system**.
4. Confirm the newest run is green before adding any provider value.
5. If it is red, stop and open the failed step. Do not enable email or payments.

## 2. Connect owner dashboard report synchronization

The same secret must be stored in the private site settings and in GitHub. Never
paste the secret into a file, issue, chat message, workflow input, or commit.

1. Generate one random 64-character secret in a password manager.
2. In the private Site settings, add:
   - `OWNER_EMAIL` = the email used for the approved ChatGPT owner account
   - `REPORT_SYNC_SECRET` = the random secret
3. In GitHub, open **Settings → Secrets and variables → Actions → Secrets**.
4. Click **New repository secret**.
5. Name it `REPORT_SYNC_SECRET` and paste the same random secret.
6. In **Actions → Variables**, add `REPORT_SYNC_URL` with the private Site URL
   followed by `/api/internal/reports`.
7. Keep `PAYMENTS_MODE` disabled and do not add delivery keys yet.
8. Manually run **Generate weekly approval packet** with:
   - Customer: `founder-pilot-olympia`
   - Report date: `2026-08-03`
   - Approve delivery: `NO`
9. Open the owner dashboard and confirm one report appears with five
   opportunities, passing validation, and pending approval.

## 3. Create a Resend test account only when ready

1. Go to https://resend.com and create an account.
2. Verify the email address requested by Resend.
3. Use Resend’s test-email instructions; do not enter a fake customer address.
4. Create a restricted sending key for this repository.
5. In GitHub Actions secrets, add it as `RESEND_API_KEY`.
6. In GitHub Actions variables, add the verified sender as
   `DELIVERY_FROM_EMAIL`.
7. Confirm the protected GitHub environment named `outbound-delivery` requires
   owner approval.
8. Do not choose `APPROVE` in the weekly workflow until a real customer profile
   has `deliveryMode: customer`, its five sources were rechecked, and the owner
   explicitly approves the exact packet.

The owner-only Olympia pilot is intentionally not eligible for email and is not
a delivery test target.

## 4. Create a Lemon Squeezy test store only when ready

1. Go to https://app.lemonsqueezy.com and create an account.
2. Leave the store in **Test mode**. New stores begin there by default.
3. Create a private test subscription product for the approved founding price.
4. Use **Share** or **Preview** to copy its test checkout URL.
5. In the private Site settings, add:
   - `PAYMENTS_MODE` = `test`
   - `LEMON_SQUEEZY_CHECKOUT_URL` = the test checkout URL
6. In Lemon Squeezy test-mode webhook settings, create a webhook pointing to the
   private Site URL followed by `/api/webhooks/lemon-squeezy`.
7. Choose a new random signing secret and store it in the private Site settings
   as `LEMON_SQUEEZY_WEBHOOK_SECRET`.
8. Subscribe the webhook to test `order_created`, `order_refunded`,
   `subscription_created`, `subscription_cancelled`, and
   `subscription_expired` events.
9. In the owner dashboard, mark only an accepted pilot lead as **Approve test checkout**.
10. Open the displayed test checkout link.
11. Use only Lemon Squeezy’s published test card details. Never use a real card.
12. Confirm a test payment event appears in the owner dashboard.
13. Return `PAYMENTS_MODE` to `disabled` after the rehearsal if no further test is planned.

## 5. Keep launch locked

Do not make the Site public, activate a live store, enable live email, purchase a
domain, spend money, or accept a customer payment until every unchecked item in
`business/LAUNCH_CHECKLIST.md` has evidence and the owner separately approves
public launch.
