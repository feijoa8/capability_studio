type Props = {
  headline: string;
  subhead: string;
  signupHref: string;
};

export function CTASection({ headline, subhead, signupHref }: Props) {
  return (
    <section className="section" aria-labelledby="cta-heading">
      <div
        className="container"
        style={{
          padding: "clamp(2rem, 5vw, 3rem)",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          background:
            "linear-gradient(135deg, var(--accent-muted) 0%, var(--surface) 55%, var(--bg-elevated) 100%)",
          textAlign: "center",
        }}
      >
        <h2
          id="cta-heading"
          style={{ fontSize: "1.65rem", fontWeight: 650, margin: "0 0 0.75rem" }}
        >
          {headline}
        </h2>
        <p style={{ margin: "0 auto 1.5rem", maxWidth: "48ch" }}>{subhead}</p>
        <a href={signupHref} className="btn btn-primary">
          Get started
        </a>
      </div>
    </section>
  );
}
