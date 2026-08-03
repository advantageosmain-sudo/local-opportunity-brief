import { secureStringEqual } from "./security.mjs";

const ALLOWED_TEST_EVENTS = new Set([
  "order_created",
  "order_refunded",
  "subscription_created",
  "subscription_cancelled",
  "subscription_expired",
]);

export async function verifyLemonSqueezySignature(rawBody, signature, secret) {
  if (!rawBody || !/^[a-f0-9]{64}$/i.test(signature ?? "") || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return secureStringEqual(expected.toLowerCase(), signature.toLowerCase());
}

export function buildTestCheckoutUrl(baseUrl, leadId) {
  if (!/^[a-f0-9-]{16,64}$/i.test(leadId)) throw new Error("Invalid lead ID.");
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "lemonsqueezy.com" || url.hostname.endsWith(".lemonsqueezy.com")) ||
    !url.pathname.startsWith("/checkout/")
  ) {
    throw new Error("Checkout URL must be an HTTPS Lemon Squeezy checkout link.");
  }
  url.searchParams.set("checkout[custom][lead_id]", leadId);
  url.searchParams.set("checkout[custom][business]", "local-opportunity-brief");
  return url.toString();
}

export function parseTestWebhook(rawBody, eventHeader) {
  const payload = JSON.parse(rawBody);
  const eventName = payload?.meta?.event_name;
  if (!eventName || eventName !== eventHeader || !ALLOWED_TEST_EVENTS.has(eventName)) {
    throw new Error("Unsupported or mismatched webhook event.");
  }
  if (payload?.data?.attributes?.test_mode !== true) {
    throw new Error("Live payment events are blocked by this endpoint.");
  }
  const externalId = String(payload?.data?.id ?? "");
  if (!externalId || externalId.length > 100) throw new Error("Webhook object ID is invalid.");
  const leadId = payload?.meta?.custom_data?.lead_id;
  if (leadId && !/^[a-f0-9-]{16,64}$/i.test(String(leadId))) {
    throw new Error("Webhook lead ID is invalid.");
  }
  return {
    payload,
    eventName,
    externalId: `${eventName}:${externalId}`,
    leadId: leadId ? String(leadId) : null,
  };
}

export function leadStatusForTestEvent(eventName) {
  if (["order_created", "subscription_created"].includes(eventName)) {
    return "test_payment_confirmed";
  }
  if (["subscription_cancelled", "subscription_expired"].includes(eventName)) {
    return "test_payment_cancelled";
  }
  if (eventName === "order_refunded") return "test_payment_refunded";
  return null;
}
