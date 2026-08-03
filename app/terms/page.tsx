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
          <p>Effective August 2, 2026 · Private-pilot operating version</p>
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
          <h2>Price, cancellation, and refunds</h2>
          <p>
            The proposed founding price is $49 per month. A customer may cancel
            before the next renewal date; future renewals stop and service
            continues through the paid period. A customer may request a refund
            if the first paid brief is more than seven days late or a material
            factual error makes a delivered brief unusable, provided the request
            is made within seven days of delivery. An accurate, on-time brief is
            not refundable solely because it was not used or did not create sales.
            Rights required by applicable law still apply.
          </p>
          <h2>Source timing</h2>
          <p>
            Sources are checked for the stated report date. Events and public
            information can change after a brief is prepared, so customers must
            reopen the linked source before publishing a promotion or making a
            purchase based on it.
          </p>
          <div className="sample-disclaimer">
            These private-pilot terms are not activated for billing and still
            require owner and qualified legal review before public launch.
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
