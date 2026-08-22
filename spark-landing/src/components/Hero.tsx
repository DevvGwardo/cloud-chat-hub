const REPO = "https://github.com/DevvGwardo/spark";
const RELEASES = `${REPO}/releases`;

export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="app-icon" aria-hidden="true">
        <img src="/spark-app-icon.png" alt="" />
      </div>
      <h1 className="wordmark">Spark</h1>
      <p className="subtitle">
        A desktop coding agent that reads your code, runs terminals, and ships
        PRs — powered by Hermes.
      </p>
      <div className="hero-actions">
        <button
          className="btn btn-pill btn-glimmer"
          onClick={() => window.open(RELEASES, "_blank")}
        >
          Download for Windows
        </button>
        <a className="btn btn-frost" href={REPO} target="_blank" rel="noopener">
          Explore on GitHub
        </a>
      </div>
      <p className="available">
        Available for{" "}
        <a href={RELEASES} target="_blank" rel="noopener">Windows 10/11 (x64)</a>
      </p>
    </header>
  );
}
