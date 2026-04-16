type Col = { title: string; body: string };

type Props = { columns: Col[] };

export function ValuePropositionSection({ columns }: Props) {
  return (
    <section id="value" className="section" aria-labelledby="value-heading">
      <div className="container">
        <h2
          id="value-heading"
          style={{ fontSize: "1.75rem", fontWeight: 600, margin: "0 0 2rem" }}
        >
          Why Capability Studio
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "1.5rem",
          }}
        >
          {columns.map((c) => (
            <article
              key={c.title}
              style={{
                padding: "1.5rem",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "var(--surface)",
              }}
            >
              <h3 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem", color: "var(--text)" }}>
                {c.title}
              </h3>
              <p style={{ fontSize: "0.95rem" }}>{c.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
