import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "Service terms",
  description: "Founding-validation terms for Local Opportunity Brief.",
};

export default function TermsPage() {
  return (
    <>
      <Header />
      <main className="page-main">
        <section className="page-hero shell">
          <p className="eyebrow">Service terms</p>
          <h1>Useful research, with the business owner in control.</h1>
          <p>Effective July 31, 2026 · Founding-validation version</p>
        </section>
        <article className="sample-paper" style={{ marginBottom: 100 }}>
          <h2>Service</h2>
          <p>
            Local Opportunity Brief provides research-supported local marketing
            opportunities, recommended actions, and optional promotional wording.
            The customer decides whether and how to use each recommendation.
          </p>
          <h2>No guaranteed results</h2>
          <p>
            Marketing outcomes depend on inventory, execution, customer demand,
            timing, pricing, and other conditions outside the service’s control.
            Sales, traffic, reach, or revenue are not guaranteed.
          </p>
          <h2>Customer responsibilities</h2>
          <p>
            Customers must confirm inventory, prices, availability, legal
            requirements, and the accuracy of business-specific details before
            publishing or acting on a recommendation.
          </p>
          <h2>Account access</h2>
          <p>
            The service does not require social media, email-marketing,
            advertising, banking, or storefront passwords.
          </p>
          <h2>Founding requests and payment</h2>
          <p>
            Submitting the request form does not guarantee acceptance and does
            not create a charge. Accepted businesses receive separate checkout
            and cancellation information before paying.
          </p>
          <div className="sample-disclaimer">
            These terms are an operating draft for private validation and must
            receive legal and owner review before public launch.
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
