import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { IntakeForm } from "@/components/intake-form";

export const metadata: Metadata = {
  title: "Founding membership request",
  description:
    "Tell Local Opportunity Brief about your independent boutique or gift shop.",
};

export default function IntakePage() {
  return (
    <>
      <Header />
      <main className="page-main">
        <section className="page-hero shell">
          <p className="eyebrow">Founding membership request</p>
          <h1>Tell us what makes your business local.</h1>
          <p>
            We review your products, location, and available public sources
            before offering a paid founding spot. Submitting this form does not
            charge you.
          </p>
        </section>

        <section className="shell intake-layout">
          <aside className="intake-aside">
            <h2>What happens next</h2>
            <p>
              We make sure the service can produce a useful, well-sourced brief
              for your location before accepting payment.
            </p>
            <ol>
              <li>Your business information is reviewed.</li>
              <li>Local source coverage is checked.</li>
              <li>You receive a fit decision and, if accepted, a secure checkout.</li>
              <li>Your first brief is prepared for the following Monday cycle.</li>
            </ol>
          </aside>
          <IntakeForm />
        </section>
      </main>
      <Footer />
    </>
  );
}
