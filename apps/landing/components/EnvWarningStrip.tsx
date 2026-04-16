import type { PublicEnvKey } from "@/lib/publicEnv";

export function EnvWarningStrip({ missing }: { missing: PublicEnvKey[] }) {
  if (missing.length === 0) return null;
  return (
    <div
      role="status"
      style={{
        background: "#4a3a12",
        color: "#faf6e7",
        padding: "10px 16px",
        fontSize: "0.85rem",
        textAlign: "center",
        borderBottom: "1px solid rgba(196, 245, 66, 0.25)",
      }}
    >
      Configuration incomplete: missing {missing.join(", ")}. Auth, help chat, or
      metadata may not work until these are set.
    </div>
  );
}
