export function Header() {
  return (
    <header className="site-header">
      <div className="shell site-header-inner">
        <a className="brand" href="/" aria-label="Local Opportunity Brief home">
          <span className="brand-mark" aria-hidden="true">
            LO
          </span>
          <span>Local Opportunity Brief</span>
        </a>
        <nav className="site-nav" aria-label="Main navigation">
          <a href="/#how-it-works">How it works</a><a href="/sample">Sample brief</a>
          <a href="/#pricing">Pricing</a>
          <a className="button button-primary button-small" href="/intake">
            Founding membership
          </a>
        </nav>
      </div>
    </header>
  );
}

