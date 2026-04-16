import { supabase } from "../../lib/supabase";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

export type CvExtractMeta = {
  text_length: number;
  truncated: boolean;
  stored_cv: { id: string; storage_path: string } | null;
  /** When personal CV storage uses "latest wins", number of older rows replaced/cleaned up. */
  replaced_personal_cv_count?: number;
  filename: string;
  mime: string;
};

export type CvExtractTarget =
  | { kind: "workspace"; organisationId: string }
  | { kind: "personal_profile" };

export async function requestCvExtract(
  file: File,
  storeCv: boolean,
  target: CvExtractTarget
): Promise<{ extracted: unknown; meta: CvExtractMeta }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) {
    throw new Error("Not signed in.");
  }
  if (!supabaseUrl) {
    throw new Error("Missing VITE_SUPABASE_URL.");
  }

  const form = new FormData();
  form.append("file", file);
  form.append("storeCv", storeCv ? "true" : "false");
  if (target.kind === "workspace") {
    const oid = target.organisationId.trim();
    if (!oid) {
      throw new Error("organisationId is required.");
    }
    form.append("organisationId", oid);
  } else {
    form.append("personalProfile", "true");
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/import-cv-extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: form,
  });

  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    extracted?: unknown;
    meta?: CvExtractMeta;
  };
  if (!res.ok) {
    const msg =
      typeof json.error === "string" ? json.error : "CV import failed.";
    const code =
      typeof json.code === "string" && json.code.length > 0
        ? ` [${json.code}]`
        : "";
    throw new Error(`${msg}${code}`);
  }
  if (!json.extracted || !json.meta) {
    throw new Error("Invalid response from import service.");
  }
  return { extracted: json.extracted, meta: json.meta };
}
