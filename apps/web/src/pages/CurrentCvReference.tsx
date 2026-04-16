import {
  accentMuted,
  borderSubtle,
  btn,
  btnGhost,
  mutedColor,
  text,
} from "./hub/hubTheme";

export type StoredCvRow = {
  id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  uploaded_at: string;
};

function formatCvUploadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatMimeLabel(mime: string | null): string | null {
  if (!mime?.trim()) return null;
  const m = mime.toLowerCase();
  if (m === "application/pdf") return "PDF";
  if (
    m ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    m.includes("wordprocessingml")
  ) {
    return "Word";
  }
  const short = mime.replace(/^application\//, "");
  return short.length > 24 ? `${short.slice(0, 22)}…` : short;
}

type Props = {
  storedCv: StoredCvRow;
  onReplace: () => void;
  onRemove: () => void;
  removing: boolean;
};

export function CurrentCvReference({
  storedCv,
  onReplace,
  onRemove,
  removing,
}: Props) {
  const typeLabel = formatMimeLabel(storedCv.mime_type);

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        backgroundColor: accentMuted,
        border: `1px solid rgba(110, 176, 240, 0.22)`,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: mutedColor,
            }}
          >
            Current CV
          </p>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 14,
              fontWeight: 600,
              color: text,
              wordBreak: "break-word",
            }}
          >
            {storedCv.original_filename}
          </p>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: mutedColor,
              lineHeight: 1.45,
            }}
          >
            Uploaded {formatCvUploadedAt(storedCv.uploaded_at)}
            {typeLabel ? (
              <>
                {" "}
                <span style={{ color: borderSubtle }}>·</span> {typeLabel}
              </>
            ) : null}
          </p>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={onReplace}
            style={{ ...btnGhost, fontSize: 12, padding: "6px 12px" }}
          >
            Replace CV
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            style={{ ...btn, fontSize: 12, padding: "6px 12px" }}
          >
            {removing ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
