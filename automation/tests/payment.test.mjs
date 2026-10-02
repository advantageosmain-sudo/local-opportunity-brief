import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTestCheckoutUrl,
  parseTestWebhook,
  verifyLemonSqueezySignature,
} from "../../lib/lemon-squeezy.mjs";

const secret = "test-signing-secret";
const payload = JSON.stringify({
  meta: {
    event_name: "order_created",
    custom_data: { lead_id: "123e4567-e89b-12d3-a456-426614174000" },
  },
  data: {
    id: "42",
    type: "orders",
    attributes: { test_mode: true },
  },
});

async function sign(value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

test("test checkout carries the lead ID without enabling a live payment mode", () => {
  const url = new URL(
    buildTestCheckoutUrl(
      "https://owner-store.lemonsqueezy.com/checkout/buy/test-variant",
      "123e4567-e89b-12d3-a456-426614174000",
    ),
  );
  assert.equal(
    url.searchParams.get("checkout[custom][lead_id]"),
    "123e4567-e89b-12d3-a456-426614174000",
  );
  assert.throws(() =>
    buildTestCheckoutUrl(
      "https://checkout.example.com/buy/1",
      "123e4567-e89b-12d3-a456-426614174000",
    ),
  );
});

test("webhook signature validation accepts exact bytes and rejects tampering", async () => {
  const signature = await sign(payload);
  assert.equal(await verifyLemonSqueezySignature(payload, signature, secret), true);
  assert.equal(await verifyLemonSqueezySignature(`${payload} `, signature, secret), false);
});

test("checkout links require a single canonical buy target", () => {
  const leadId = "123e4567-e89b-12d3-a456-426614174000";
  for (const path of [
    "/checkout/", "/checkout/foo", "/checkout/buy", "/checkout/buy/",
    "/checkout/buy/target/extra", "/checkout/buy/%2Ftarget",
    "/Checkout/buy/target", "/checkout/BUY/target",
  ]) {
    assert.throws(() => buildTestCheckoutUrl(`https://unit.lemonsqueezy.com${path}`, leadId), /Checkout URL/);
  }
  const url = new URL(buildTestCheckoutUrl("https://unit.lemonsqueezy.com/checkout/buy/unit-variant?checkout%5Bemail%5D=unit%40example.com", leadId));
  assert.equal(url.pathname, "/checkout/buy/unit-variant");
  assert.equal(url.searchParams.get("checkout[email]"), "unit@example.com");
  assert.equal(url.searchParams.get("checkout[custom][lead_id]"), leadId);
});

test("only signed test-mode payment events are parsed", () => {
  const parsed = parseTestWebhook(payload, "order_created");
  assert.equal(parsed.eventName, "order_created");
  assert.equal(parsed.leadId, "123e4567-e89b-12d3-a456-426614174000");

  const parsedPayload = JSON.parse(payload);
  const livePayload = JSON.stringify({
    ...parsedPayload,
    data: { ...parsedPayload.data, attributes: { test_mode: false } },
  });
  assert.throws(() => parseTestWebhook(livePayload, "order_created"), /Live payment events/);
});
