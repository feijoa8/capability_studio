type Props = {
  headline: string;
  subhead: string;
  ctaPrimaryLabel: string;
  ctaSecondaryLabel: string;
  signupHref: string;
  loginHref: string;
  openAppHref: string;
  isAuthenticated: boolean;
};

export function HeroSection({
  headline,
  subhead,
  ctaPrimaryLabel,
  ctaSecondaryLabel,
  signupHref,
  loginHref,
  openAppHref,
  isAuthenticated,
}: Props) {
  return (
    <section
      id="hero"
      className="section"
      style={{ paddingTop: "clamp(2.5rem, 8vw, 5rem)" }}
    >
      <div className="container">
        <p className="eyebrow">Feijoa8 · Capability Studio</p>
        <h1
          style={{
            fontSize: "clamp(2.25rem, 5vw, 3.25rem)",
            fontWeight: 650,
            maxWidth: "18ch",
            margin: "0 0 1.25rem",
          }}
        >
          {headline}
        </h1>
        <p
          style={{
            fontSize: "1.125rem",
            maxWidth: "52ch",
            marginBottom: "2rem",
          }}
        >
          {subhead}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          {isAuthenticated ? (
            <a href={openAppHref} className="btn btn-primary">
              Open app
            </a>
          ) : (
            <>
              <a href={signupHref} className="btn btn-primary">
                {ctaPrimaryLabel}
              </a>
              <a href={openAppHref} className="btn btn-ghost">
                Open app
              </a>
              <a href={loginHref} className="btn btn-ghost">
                {ctaSecondaryLabel}
              </a>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
