"use client";

import { FormEvent, useState } from "react";

type FormState =
  | { kind: "idle"; message: "" }
  | { kind: "sending"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function IntakeForm() {
  const [state, setState] = useState<FormState>({ kind: "idle", message: "" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState({ kind: "sending", message: "Saving your business profile…" });

    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "We could not save your information.");
      }
      form.reset();
      setState({
        kind: "success",
        message:
          result.message ??
          "Your founding membership request has been received.",
      });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "We could not save your information. Please try again.",
      });
    }
  }

  return (
    <form className="intake-form" onSubmit={submit}>
      <div className="form-section">
        <h2>Contact details</h2>
        <p>We use this information only to review and respond to your request.</p>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="contactName">Your name</label>
            <input id="contactName" name="contactName" required maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="email">Business email</label>
            <input id="email" name="email" type="email" required maxLength={180} />
          </div>
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
            <label htmlFor="notes">Anything else we should know?</label>
            <textarea id="notes" name="notes" maxLength={1500} />
          </div>
        </div>
      </div>

      <div className="form-actions">
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
            ? "Saving…"
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
