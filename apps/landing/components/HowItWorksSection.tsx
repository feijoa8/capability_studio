type Step = { title: string; body: string };

type Props = { steps: Step[] };

export function HowItWorksSection({ steps }: Props) {
  return (
    <section
      id="how-it-works"
      className="section"
      style={{ background: "var(--bg-elevated)" }}
      aria-labelledby="how-heading"
    >
      <div className="container">
        <h2
          id="how-heading"
          style={{ fontSize: "1.75rem", fontWeight: 600, margin: "0 0 2rem" }}
        >
          How it works
        </h2>
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: "1.25rem",
            counterReset: "step",
          }}
        >
          {steps.map((s, i) => (
            <li
              key={s.title}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "1rem",
                alignItems: "start",
                padding: "1.25rem",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "var(--bg)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "10px",
                  background: "var(--accent-muted)",
                  color: "var(--accent)",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 700,
                  fontSize: "1rem",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              <div>
                <h3 style={{ fontSize: "1.1rem", margin: "0 0 0.35rem", color: "var(--text)" }}>
                  {s.title}
                </h3>
                <p style={{ fontSize: "0.95rem" }}>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
