type Item = { title: string; body: string };

type Props = { items: Item[] };

export function FeaturesSection({ items }: Props) {
  return (
    <section id="features" className="section" aria-labelledby="features-heading">
      <div className="container">
        <h2
          id="features-heading"
          style={{ fontSize: "1.75rem", fontWeight: 600, margin: "0 0 0.5rem" }}
        >
          Product capabilities
        </h2>
        <p style={{ marginBottom: "2rem", maxWidth: "60ch" }}>
          From taxonomy governance to adoption — everything stays connected to roles and outcomes.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "1rem",
          }}
        >
          {items.map((f) => (
            <article
              key={f.title}
              style={{
                padding: "1.25rem",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "var(--surface)",
              }}
            >
              <h3 style={{ fontSize: "1rem", margin: "0 0 0.5rem", color: "var(--accent)" }}>
                {f.title}
              </h3>
              <p style={{ fontSize: "0.9rem" }}>{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
