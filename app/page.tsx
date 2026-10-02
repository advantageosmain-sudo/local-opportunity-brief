import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import sample from "@/business/evidence/public-sample-olympia-2026-10-02.json";
const sampleOpportunities=sample.opportunities;

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <section className="hero shell">
          <div className="hero-copy">
            <p className="eyebrow">Built for independent local retailers</p>
            <h1>Know what&rsquo;s happening. Know what to do next.</h1>
            <p className="hero-lede">
              Every Monday, receive five verified local sales opportunities,
              ready-to-use promotional wording, and a simple action plan for
              your boutique or gift shop.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="/intake">
                Request a founding spot
              </a>
              <a className="button button-secondary" href="/sample">
                Read a sample brief
              </a>
            </div>
            <ul className="trust-list" aria-label="Membership promises">
              <li>Real source links</li>
              <li>No account access</li>
              <li>Cancel anytime</li>
            </ul>
          </div>

          <aside className="brief-preview" aria-label="Sample opportunity brief">
            <div className="brief-preview-top">
              <span>Illustrative sample</span>
              <span>5 opportunities</span>
            </div>
            <p className="brief-business">Example gift shop · Olympia, Washington</p>
            <div className="brief-score">01</div>
            <p className="brief-score-label">Sample priority · checked Oct 2, 2026</p>
            <h2>{sampleOpportunities[0].title}</h2>
            <p>{sampleOpportunities[0].why}</p>
            <div className="mini-action">
              <span>Do this first</span>
              <strong>{sampleOpportunities[0].firstAction}</strong>
            </div>
            <div className="preview-stack" aria-hidden="true" />
          </aside>
        </section>

        <section className="section shell" id="how-it-works"><p className="eyebrow">How it works</p><h2>From your location to your next useful action.</h2><ol className="anatomy-list"><li>Join and tell us about your United States business.</li><li>We check local sources and select five relevant opportunities.</li><li>Your first report receives owner quality review before delivery.</li><li>Future briefs arrive weekly while your subscription is active.</li></ol><p>Intake takes about five minutes. We confirm source coverage and your first delivery date before billing begins.</p></section><section className="signal-strip">
          <div className="shell signal-grid">
            <div>
              <strong>5</strong>
              <span>ranked opportunities</span>
            </div>
            <div>
              <strong>30</strong>
              <span>days looked ahead</span>
            </div>
            <div>
              <strong>1</strong>
              <span>clear weekly plan</span>
            </div>
          </div>
        </section>

        <section className="section shell">
          <div className="section-heading">
            <p className="eyebrow">Not another generic content calendar</p>
            <h2>Your town changes every week. Your marketing should notice.</h2>
            <p>
              The brief connects verified community activity to products you
              actually sell, then turns the strongest matches into specific
              actions.
            </p>
          </div>
          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-number">01</span>
              <h3>We watch locally</h3>
              <p>
                Official event calendars, school schedules, seasonal moments,
                and customer-provided information are checked for your area.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-number">02</span>
              <h3>We rank what fits</h3>
              <p>
                Each finding is scored for distance, timing, customer fit,
                product fit, source quality, and preparation time.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-number">03</span>
              <h3>You get the action</h3>
              <p>
                The final brief tells you what to offer, what to say, when to
                publish, and what to prepare first.
              </p>
            </article>
          </div>
        </section>

        <section className="section section-ink">
          <div className="shell brief-anatomy">
            <div>
              <p className="eyebrow eyebrow-light">Inside every Monday brief</p>
              <h2>A useful plan, not a pile of ideas.</h2>
              <p>
                Everything is written for a busy owner who needs to act quickly.
                You can use the wording as written or make it your own.
              </p>
              <a className="text-link text-link-light" href="/sample">
                Open the complete sample <span aria-hidden="true">→</span>
              </a>
            </div>
            <ol className="anatomy-list">
              <li>
                <span>01</span>
                <div>
                  <strong>Top five opportunities</strong>
                  <p>Ranked by relevance, urgency, and evidence quality.</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Ready-to-use campaign ideas</strong>
                  <p>Offers, captions, email copy, and recommended dates.</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>One short action checklist</strong>
                  <p>The exact preparation steps in the right order.</p>
                </div>
              </li>
              <li>
                <span>04</span>
                <div>
                  <strong>Original evidence links</strong>
                  <p>See where every event, date, and factual claim came from.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className="section shell pricing-wrap" id="pricing">
          <div className="pricing-copy">
            <p className="eyebrow">Founding membership</p>
            <h2>One useful report every Monday.</h2>
            <p>
              The first ten businesses help shape the service and keep the
              founding price while their membership remains active.
            </p>
            <p className="small-note">
              We provide researched marketing information, not guaranteed sales
              results. You remain in control of every promotion you use.
            </p>
          </div>
          <div className="price-card">
            <p>Weekly Local Opportunity Brief</p>
            <div className="price">
              <span>$</span>
              <strong>49</strong>
              <span>/month</span>
            </div>
            <ul>
              <li>A brief each week, including five-Monday months</li>
              <li>Five verified opportunities per brief</li>
              <li>Captions and customer email copy</li>
              <li>Thirty-day local opportunity watch</li>
              <li>Cancel anytime</li>
            </ul>
            <a className="button button-primary button-full" href="/intake">
              Request a founding spot
            </a>
            <p className="capacity-note">Limited to 10 founding businesses.</p>
          </div>
        </section>

        <section className="section shell faq-section">
          <div>
            <p className="eyebrow">Straight answers</p>
            <h2>Frequently asked questions</h2>
          </div>
          <div className="faq-list">
            <details><summary>Which locations are supported?</summary><p>United States locations are assessed individually for reliable public source coverage. We confirm coverage before accepting a paid membership.</p></details>
            <details><summary>What if event details are missing or change?</summary><p>We show source check dates, confidence, and unpublished details explicitly. An unverified event is excluded; a report with fewer than five verified opportunities is held for correction. Recheck original sources before acting.</p></details>
            <details><summary>Can I use school or event logos?</summary><p>A report does not grant trademark, artwork, or endorsement rights. Obtain permission before using protected logos, names in a misleading way, or licensed designs.</p></details>
            <details><summary>How do delivery, cancellation, and refunds work?</summary><p>Briefs arrive by email. You can request cancellation before renewal through support. See the cancellation and refund policy for service and timing details.</p></details>
            <details><summary>How is my information used?</summary><p>Your business profile helps tailor reports and manage your subscription. We do not sell it. The privacy notice explains service providers, retention, and deletion requests.</p></details>
            <details>
              <summary>Do you post to my social media?</summary>
              <p>
                No. We never need your passwords or account access. You choose
                which recommendations to use and publish them yourself.
              </p>
            </details>
            <details>
              <summary>Where does the information come from?</summary>
              <p>
                We use approved public sources such as official event,
                community, school, tourism, and chamber calendars. Every factual
                opportunity includes its source.
              </p>
            </details>
            <details>
              <summary>Will every idea increase my sales?</summary>
              <p>
                No marketing service can honestly guarantee that. We provide
                researched, timely opportunities and practical actions; you
                decide what fits your inventory and customers.
              </p>
            </details>
            <details>
              <summary>What happens after I apply?</summary>
              <p>
                We review your location, products, and local source coverage.
                If the service is a good fit, you receive your founding checkout
                and onboarding confirmation.
              </p>
            </details>
          </div>
        </section>

        <section className="cta-band">
          <div className="shell">
            <div>
              <p className="eyebrow">Your next Monday can be clearer</p>
              <h2>Stop guessing what to promote.</h2>
            </div>
            <a className="button button-cream" href="/intake">
              Tell us about your business
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

