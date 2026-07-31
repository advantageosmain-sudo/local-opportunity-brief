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
          <p>Effective July 31, 2026 · Founding-validation version</p>
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
            after the validation period unless a longer period is required for
            security or legal reasons. Contact instructions will be added before
            public launch. Until then, this application remains in private
            validation.
          </p>
          <div className="sample-disclaimer">
            This notice is an operating draft for private validation and must
            receive legal and owner review before public launch.
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
