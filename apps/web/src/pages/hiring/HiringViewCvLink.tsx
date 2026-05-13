import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { errorColor, mutedColor } from "../hub/hubTheme";
import {
  hiringApplicationHasViewableExternalCv,
  openHiringApplicationCv,
  type HiringApplicationRow,
} from "./hiringApi";

type Props = {
  row: HiringApplicationRow;
  /** Call on click to avoid toggling parent (e.g. card expand). */
  stopPropagation?: boolean;
  /** Slightly more prominent on expanded panel vs compact on card. */
  variant?: "card" | "panel";
};

export function HiringViewCvLink({
  row,
  stopPropagation = true,
  variant = "card",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState(false);

  if (!hiringApplicationHasViewableExternalCv(row)) return null;

  const isPanel = variant === "panel";
  const fontSize = isPanel ? 12 : 11;

  async function handleClick(e: React.MouseEvent) {
    if (stopPropagation) {
      e.stopPropagation();
    }
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await openHiringApplicationCv(supabase, row);
      if (!res.ok) setErr(res.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: isPanel ? 0 : 4,
        marginBottom: isPanel ? 10 : 0,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: isPanel ? 10 : 6,
      }}
    >
      <button
        type="button"
        disabled={busy}
        onClick={(e) => void handleClick(e)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          cursor: busy ? "wait" : "pointer",
          fontSize,
          fontWeight: 400,
          color: mutedColor,
          textDecoration: hover && !busy ? "underline" : "none",
          textUnderlineOffset: 2,
        }}
        title="Opens in a new tab"
      >
        {busy ? "Opening CV…" : "View CV ↗"}
      </button>
      {err ? (
        <span style={{ fontSize: 11, color: errorColor, lineHeight: 1.3 }}>
          {err}
        </span>
      ) : null}
    </div>
  );
}
