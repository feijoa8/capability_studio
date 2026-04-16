type Item = { title: string; body: string };

type Props = { items: Item[] };

export function UseCasesSection({ items }: Props) {
  return (
    <section
      id="use-cases"
      className="section"
      style={{ background: "var(--bg-elevated)" }}
      aria-labelledby="use-heading"
    >
      <div className="container">
        <h2
          id="use-heading"
          style={{ fontSize: "1.75rem", fontWeight: 600, margin: "0 0 2rem" }}
        >
          Who it&apos;s for
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "1.25rem",
          }}
        >
          {items.map((u) => (
            <article
              key={u.title}
              style={{
                padding: "1.5rem",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "var(--bg)",
              }}
            >
              <h3 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem", color: "var(--text)" }}>
                {u.title}
              </h3>
              <p style={{ fontSize: "0.95rem" }}>{u.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
