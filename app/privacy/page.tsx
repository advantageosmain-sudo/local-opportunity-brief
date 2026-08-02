import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "How Local Opportunity Brief handles membership-request information.",
};

export default function PrivacyPage() {
  return (
    <>
      <Header />
      <main className="page-main">
        <section className="page-hero shell">
          <p className="eyebrow">Privacy notice</p>
          <h1>We collect only what we need to review your request.</h1>
          <p>Effective August 2, 2026 · Private-pilot operating version</p>
        </section>
        <article className="sample-paper" style={{ marginBottom: 100 }}>
          <h2>Information collected</h2>
          <p>
            The founding request asks for your name, business email, business
            name, website, location, products, typical customers, preferred
            voice, exclusions, and optional notes.
          </p>
          <h2>How it is used</h2>
          <p>
            The information is used to evaluate whether Local Opportunity Brief
            can serve your business, prepare a sample or paid brief if accepted,
            communicate about the request, and protect the service from misuse.
          </p>
          <h2>What is not collected here</h2>
          <p>
            This form does not collect card numbers, bank information, social
            media passwords, customer lists, or access to your business accounts.
          </p>
          <h2>Sharing</h2>
          <p>
            Information is not sold. Service providers may process limited data
            only when needed to host the application, deliver email, process an
            approved payment, or protect the service.
          </p>
          <h2>Retention and requests</h2>
          <p>
            Founding requests that are not accepted are scheduled for deletion
            within 90 days of the final decision. Active customer profiles and
            weekly reports are kept while service is active and for up to 12
            months after cancellation. Delivery and payment-event records may be
            kept for up to 24 months when needed for accounting, fraud, disputes,
            or legal obligations.
          </p>
          <p>
            A customer may request a copy, correction, or deletion by replying
            to a service email. Identity must be verified before information is
            disclosed or deleted. Records required for tax, fraud, dispute, or
            legal reasons may be retained for the required period.
          </p>
          <h2>Security and payment details</h2>
          <p>
            Owner access is restricted, report synchronization requires a
            protected secret, and payment webhooks require a valid provider
            signature. Card and bank details are handled by the payment provider
            and are not stored by this application.
          </p>
          <div className="sample-disclaimer">
            This private-pilot policy is implemented operationally but still
            requires owner and qualified legal review before public launch.
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
