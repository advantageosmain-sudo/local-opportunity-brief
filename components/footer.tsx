export function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell footer-inner">
        <div>
          <a className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              LO
            </span>
            <span>Local Opportunity Brief</span>
          </a>
          <p className="footer-copy">
            Verified local opportunities and ready-to-use weekly marketing plans
            for independent boutiques and gift shops.
          </p>
        </div>
        <nav className="footer-links" aria-label="Footer navigation">
          <a href="/sample">Sample</a>
          <a href="/intake">Apply</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/dashboard">Owner access</a>
        </nav>
        <div className="footer-bottom">
          <span>© 2026 Local Opportunity Brief</span>
          <span>
            Research-supported recommendations. No sales results are guaranteed.
          </span>
        </div>
      </div>
    </footer>
  );
}
