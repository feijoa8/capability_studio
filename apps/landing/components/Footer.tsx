import { getLoginHref, getOpenAppHref } from "@/lib/appLinks";

export function Footer() {
  const year = new Date().getFullYear();
  const loginHref = getLoginHref();
  const openAppHref = getOpenAppHref();
  return (
    <footer
      className="section"
      style={{ paddingBottom: "2.5rem", borderTop: "1px solid var(--border)" }}
    >
      <div
        className="container"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.875rem",
          color: "var(--muted)",
        }}
      >
        <p style={{ margin: 0 }}>© {year} Feijoa8 · Capability Studio</p>
        <nav aria-label="Footer">
          <ul
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "1rem",
              listStyle: "none",
              padding: 0,
              margin: 0,
            }}
          >
            <li>
              <a href={loginHref}>Login</a>
            </li>
            <li>
              <a href={openAppHref}>App</a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
