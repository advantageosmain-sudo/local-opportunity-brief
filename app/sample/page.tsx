import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { sampleOpportunities } from "@/lib/sample-report";

export const metadata: Metadata = {
  title: "Sample weekly brief",
  description:
    "Read a complete example of the weekly Local Opportunity Brief.",
};

export default function SamplePage() {
  return (
    <>
      <Header />
      <main className="page-main sample-wrap">
        <section className="page-hero shell">
          <p className="eyebrow">Complete sample</p>
          <h1>See exactly what arrives every Monday.</h1>
          <p>
            This demonstration uses fictional business details and sample source
            links. A paid brief uses the member’s real products, location,
            approved sources, and future dates.
          </p>
        </section>

        <article className="sample-paper">
          <header>
            <div className="sample-masthead">
              <span>Week of September 14, 2026</span>
              <span>Rosewood Gifts · DeWitt, Arkansas</span>
            </div>
            <h2 className="sample-title">Your five best local opportunities</h2>
            <p className="sample-intro">
              This week is about preparing early for homecoming, using downtown
              activity without relying on discounts, and making your existing
              inventory easier to shop.
            </p>
          </header>

          {sampleOpportunities.map((opportunity) => (
            <section className="opportunity-card" key={opportunity.rank}>
              <div className="opportunity-rank" aria-label={`Rank ${opportunity.rank}`}>
                {opportunity.rank}
              </div>
              <div>
                <h2>{opportunity.title}</h2>
                <p className="opportunity-meta">
                  Fit score {opportunity.score}/100 · {opportunity.date}
                </p>
                <p>{opportunity.why}</p>
                <div className="action-box">
                  <strong>Recommended offer</strong>
                  <span>{opportunity.offer}</span>
                </div>
                <div className="action-box">
                  <strong>Do this first</strong>
                  <span>{opportunity.firstAction}</span>
                </div>
                <div className="caption-box">
                  <strong>Ready-to-use caption</strong>
                  <span>{opportunity.caption}</span>
                </div>
                <p className="source-line">
                  Evidence:{" "}
                  <a href={opportunity.sourceUrl} rel="noreferrer">
                    {opportunity.sourceLabel}
                  </a>
                </p>
              </div>
            </section>
          ))}

          <aside className="sample-disclaimer">
            This sample demonstrates the format, not live event research. Live
            reports must pass date, location, source, duplication, customer-fit,
            wording, and delivery checks before they can be approved.
          </aside>
        </article>

        <div className="shell hero-actions" style={{ justifyContent: "center", marginTop: 42 }}>
          <a className="button button-primary" href="/intake">
            Request a founding spot
          </a>
          <a className="button button-secondary" href="/">
            Return home
          </a>
        </div>
      </main>
      <Footer />
    </>
  );
}
