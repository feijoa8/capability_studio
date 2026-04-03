/** Shared design tokens — Capability Hub dark shell */

export const bg = "#0c0f14";
export const surface = "#151a22";
export const surfaceHover = "#1a2029";
export const border = "#2a3240";
export const borderSubtle = "#232a36";
export const text = "#e8eaef";
export const mutedColor = "#8b95a8";
export const accent = "#6eb0f0";
export const accentMuted = "rgba(110, 176, 240, 0.14)";
export const errorColor = "#e87878";

export const btn = {
  padding: "9px 16px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  color: text,
  backgroundColor: surface,
  border: `1px solid ${border}`,
  borderRadius: 8,
  transition: "background-color 0.15s ease, border-color 0.15s ease",
} as const;

export const btnPrimary = {
  ...btn,
  backgroundColor: accentMuted,
  borderColor: "rgba(110, 176, 240, 0.35)",
  color: "#c8e0ff",
} as const;

export const btnSecondary = {
  ...btn,
} as const;

export const btnGhost = {
  ...btn,
  backgroundColor: "transparent",
  borderColor: borderSubtle,
  color: mutedColor,
  fontWeight: 400,
  fontSize: 12,
  padding: "6px 12px",
} as const;

export const inputField = {
  padding: "9px 12px",
  fontSize: 14,
  color: text,
  backgroundColor: bg,
  border: `1px solid ${border}`,
  borderRadius: 8,
  outline: "none",
} as const;

export const section = { marginTop: 28 } as const;

export const muted = { color: mutedColor, fontSize: 14 } as const;

export const h2 = {
  margin: 0,
  fontSize: 17,
  fontWeight: 600,
  color: text,
  letterSpacing: "-0.02em",
} as const;

export const sectionTitle = {
  margin: "0 0 4px",
  fontSize: 17,
  fontWeight: 600,
  color: text,
  letterSpacing: "-0.02em",
} as const;

export const sectionSubtitle = {
  margin: 0,
  fontSize: 13,
  color: mutedColor,
  lineHeight: 1.5,
} as const;

export const sectionEyebrow = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.07em",
  textTransform: "uppercase" as const,
  color: mutedColor,
} as const;

export const panelShell = {
  padding: "14px 16px",
  borderRadius: 10,
  backgroundColor: surface,
  border: `1px solid ${border}`,
  boxSizing: "border-box" as const,
} as const;

export const profileCardShell = {
  padding: "14px 16px",
  borderRadius: 10,
  backgroundColor: surface,
  border: `1px solid ${border}`,
  listStyle: "none" as const,
} as const;

export const activeBanner = {
  padding: "14px 16px",
  borderRadius: 10,
  backgroundColor: "rgba(110, 176, 240, 0.08)",
  border: `1px solid rgba(110, 176, 240, 0.25)`,
} as const;

export type GapTriPillStyle = "below" | "meets" | "above" | "unassessed";

export function gapTriPillStyle(tri: GapTriPillStyle): {
  color: string;
  backgroundColor: string;
  border: string;
} {
  switch (tri) {
    case "below":
      return {
        color: "#f0b0b0",
        backgroundColor: "rgba(232, 120, 120, 0.12)",
        border: "1px solid rgba(232, 120, 120, 0.35)",
      };
    case "above":
      return {
        color: "#7ecf9a",
        backgroundColor: "rgba(126, 207, 154, 0.1)",
        border: "1px solid rgba(126, 207, 154, 0.35)",
      };
    case "meets":
      return {
        color: mutedColor,
        backgroundColor: "rgba(139, 149, 168, 0.06)",
        border: "1px solid rgba(139, 149, 168, 0.25)",
      };
    default:
      return {
        color: mutedColor,
        backgroundColor: "transparent",
        border: `1px solid ${borderSubtle}`,
      };
  }
}
