"use client";

import { FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";

type FormState =
  | { kind: "idle"; message: "" }
  | { kind: "sending"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type CheckoutCapability = { customerId: string; checkoutToken: string };

function checkoutCapability(value: unknown): CheckoutCapability | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Partial<CheckoutCapability>;
  if (typeof saved.customerId !== "string" || !/^[a-f0-9]{64}$/.test(saved.customerId) ||
      typeof saved.checkoutToken !== "string" || !saved.checkoutToken || saved.checkoutToken.length > 256) return null;
  return { customerId: saved.customerId, checkoutToken: saved.checkoutToken };
}

function subscribeToReturn(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("pageshow", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("pageshow", callback);
  };
}

function checkoutReturn() {
  return new URLSearchParams(window.location.search).get("checkout") === "complete";
}

export function IntakeForm() {
  const [state, setState] = useState<FormState>({ kind: "idle", message: "" });
  const [checkout, setCheckout] = useState<CheckoutCapability | null>(null);
  const inFlight = useRef(false);
  const requestSequence = useRef(0);
  const returnedFromCheckout = useSyncExternalStore(subscribeToReturn, checkoutReturn, () => false);

  useEffect(() => {
    function leave() { requestSequence.current += 1; }
    function resume(event: PageTransitionEvent) {
      if (event.persisted) {
        leave();
        inFlight.current = false;
        setState({ kind: "idle", message: "" });
      }
    }
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", leave);
    return () => {
      leave();
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  function restoreCheckout() {
    if (inFlight.current) return;
    try {
      const raw = sessionStorage.getItem("lob-checkout");
      const capability = raw ? checkoutCapability(JSON.parse(raw)) : null;
      if (capability) {
        setCheckout(capability);
        setState({ kind: "success", message: "Your saved request is restored." });
        return;
      }
      setState({ kind: "error", message: "No checkout request is saved in this browser tab. Submit your business details below or contact support." });
    } catch {
      setState({ kind: "error", message: "Saved checkout could not be restored. Contact support." });
    }
  }

  async function openBilling(action: "checkout" | "portal") {
    if (!checkout || inFlight.current) return;
    inFlight.current = true;
    const requestId = ++requestSequence.current;
    setState({ kind: "sending", message: action === "checkout" ? "Checking coverage and checkout availability…" : "Opening billing management…" });
    let redirected = false;
    try {
      const endpoint = action === "checkout" ? "/api/checkout" : "/api/billing/portal";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkout),
      });
      const result = await response.json();
      if (requestSequence.current !== requestId) return;
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Billing is unavailable.");
      if (typeof result.url !== "string") throw new Error("No billing link is available yet.");
      const url = new URL(result.url);
      const expectedHost = action === "checkout" ? "checkout.stripe.com" : "billing.stripe.com";
      if (url.protocol !== "https:" || url.hostname !== expectedHost || url.port || url.username || url.password) throw new Error("Billing address is invalid.");
      window.location.assign(url.href);
      redirected = true;
    } catch (error) {
      if (requestSequence.current !== requestId) return;
      setState({ kind: "error", message: error instanceof Error ? error.message : "Billing could not be opened." });
    } finally {
      if (requestSequence.current === requestId && !redirected) inFlight.current = false;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    const requestId = ++requestSequence.current;
    const form = event.currentTarget;
    setState({ kind: "sending", message: "Saving your business profile…" });

    try {
      const payload = { ...Object.fromEntries(new FormData(form).entries()), submissionId: crypto.randomUUID() };
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string; message?: string; customerId?: string; checkoutToken?: string };
      if (requestSequence.current !== requestId) return;
      if (!response.ok) {
        throw new Error(result.error ?? "We could not save your information.");
      }
      const capability = checkoutCapability(result);
      if (capability) {
        setCheckout(capability);
        try { sessionStorage.setItem("lob-checkout", JSON.stringify(capability)); } catch {}
      }
      form.reset();
      setState({ kind: "success", message: result.message ?? "Your founding membership request has been received." });
    } catch (error) {
      if (requestSequence.current !== requestId) return;
      setState({ kind: "error", message: error instanceof Error ? error.message : "We could not save your information. Please try again." });
    } finally {
      if (requestSequence.current === requestId) inFlight.current = false;
    }
  }

  return (
    <form className="intake-form" onSubmit={submit}>
      {returnedFromCheckout && <p className="form-status" role="status">You returned from checkout. Payment confirmation is pending a verified Stripe webhook. This page does not confirm payment or start service.</p>}
      {!checkout && <button type="button" className="button button-secondary" disabled={state.kind === "sending"} onClick={restoreCheckout}>Resume a saved request in this tab</button>}
      {checkout && <div className="form-section">
        <h2>Your saved request</h2>
        <p>Continue when local coverage is confirmed. Checkout remains blocked until the service and payment provider are ready. Billing management is available after a billing account exists.</p>
        <button type="button" className="button button-secondary" disabled={state.kind === "sending"} onClick={() => openBilling("checkout")}>Continue to checkout</button>
        <button type="button" className="button button-secondary" disabled={state.kind === "sending"} onClick={() => openBilling("portal")}>Manage billing</button>
      </div>}
      <div className="form-section">
        <h2>Contact details</h2>
        <p>We use this information only to review and respond to your request.</p>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="contactName">Your name</label>
            <input id="contactName" name="contactName" required maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="email">Report delivery email</label>
            <input id="email" name="email" type="email" required maxLength={180} />
          </div>
          <div className="field"><label htmlFor="billingEmail">Billing email (if different)</label><input id="billingEmail" name="billingEmail" type="email" maxLength={180}/></div>
          <div className="field field-full honeypot" aria-hidden="true">
            <label htmlFor="companyFax">Company fax</label>
            <input id="companyFax" name="companyFax" tabIndex={-1} autoComplete="off" />
          </div>
        </div>
      </div>

      <div className="form-section">
        <h2>Business basics</h2>
        <p>This determines the locations and opportunities the service should watch.</p>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="businessName">Business name</label>
            <input id="businessName" name="businessName" required maxLength={140} />
          </div>
          <div className="field">
            <label htmlFor="website">Website or public business page</label>
            <input
              id="website"
              name="website"
              type="url"
              placeholder="https://"
              maxLength={300}
            />
          </div>
          <div className="field">
            <label htmlFor="city">City</label>
            <input id="city" name="city" required maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="state">State</label>
            <input
              id="state"
              name="state"
              required
              minLength={2}
              maxLength={2}
              placeholder="AR"
              autoCapitalize="characters"
            />
          </div>
          <div className="field">
            <label htmlFor="zip">ZIP code</label><input id="zip" name="zip" required pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10}/></div><div className="field">
            <label htmlFor="category">Business type</label>
            <select id="category" name="category" required defaultValue="">
              <option value="" disabled>
                Select one
              </option>
              <option value="boutique">Independent boutique</option>
              <option value="gift-shop">Gift shop</option>
              <option value="apparel-shop">Local apparel shop</option>
              <option value="other-retail">Other independent retail</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="localRadius">What feels local?</label>
            <select id="localRadius" name="localRadius" defaultValue="35">
              <option value="15">Within 15 miles</option>
              <option value="25">Within 25 miles</option>
              <option value="35">Within 35 miles</option>
              <option value="50">Within 50 miles</option>
            </select>
          </div>
        </div>
      </div>

      <div className="form-section">
        <h2>What should the brief understand?</h2>
        <p>Clear answers prevent irrelevant or unusable recommendations.</p>
        <div className="field-grid">
          <div className="field field-full">
            <label htmlFor="products">Main products and typical price range</label>
            <textarea
              id="products"
              name="products"
              required
              maxLength={1500}
              placeholder="Example: women’s apparel, small gifts, candles, jewelry; mostly $12–$85"
            />
          </div>
          <div className="field field-full">
            <label htmlFor="customers">Typical customers</label>
            <textarea
              id="customers"
              name="customers"
              required
              maxLength={1200}
              placeholder="Example: local women, gift buyers, teachers, mothers, and visiting families"
            />
          </div>
          <div className="field">
            <label htmlFor="voice">Preferred voice</label>
            <input
              id="voice"
              name="voice"
              required
              maxLength={300}
              placeholder="Warm, neighborly, cheerful"
            />
          </div>
          <div className="field">
            <label htmlFor="exclusions">Subjects to avoid</label>
            <input
              id="exclusions"
              name="exclusions"
              maxLength={500}
              placeholder="Politics, alcohol, heavy discounts"
            />
          </div>
          <div className="field field-full">
            <label htmlFor="publicLinks">Public social links (one per line)</label><textarea id="publicLinks" name="publicLinks" maxLength={3000}/></div>
          <div className="field field-full"><label htmlFor="institutions">Local institutions or communities that matter</label><textarea id="institutions" name="institutions" maxLength={1500}/></div>
          <div className="field field-full"><label htmlFor="currentPromotions">Current promotions</label><textarea id="currentPromotions" name="currentPromotions" maxLength={1500}/></div>
          <div className="field"><label htmlFor="deliveryDay">Preferred delivery day</label><select id="deliveryDay" name="deliveryDay" defaultValue="monday"><option value="monday">Monday</option></select></div>
          <div className="field"><label htmlFor="deliveryPreferences">Delivery preferences</label><input id="deliveryPreferences" name="deliveryPreferences" maxLength={500} placeholder="Email, readable on my phone"/></div>
          <div className="field field-full"><label htmlFor="notes">Anything else we should know?</label>
            <textarea id="notes" name="notes" maxLength={1500} />
          </div>
        </div>
      </div>

      <div className="form-actions">
        <label className="consent"><input type="checkbox" name="deliveryConsent" value="yes" required/> I consent to receive purchased reports and essential service emails.</label>
        <label className="consent"><input type="checkbox" name="termsAccepted" value="yes" required/> <span>I accept the <a href="/terms">service terms</a>, including cancellation and refunds.</span></label>
        <label className="consent"><input type="checkbox" name="noGuaranteeAccepted" value="yes" required/> I understand sales and customer traffic are not guaranteed.</label>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 18,
            color: "var(--muted)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <input
            name="consent"
            type="checkbox"
            value="yes"
            required
            style={{ width: 18, minHeight: 18, marginTop: 1 }}
          />
          <span>
            I agree that my information may be used to review this membership
            request as described in the <a href="/privacy" style={{ textDecoration: "underline" }}>privacy notice</a>.
          </span>
        </label>
        <button
          className="button button-primary button-full"
          type="submit"
          disabled={state.kind === "sending"}
        >
          {state.kind === "sending"
            ? "Please wait…"
            : "Submit founding membership request"}
        </button>
        {state.kind !== "idle" ? (
          <p
            className={`form-status ${
              state.kind === "error"
                ? "form-status-error"
                : state.kind === "success"
                  ? "form-status-success"
                  : ""
            }`}
            role="status"
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}


