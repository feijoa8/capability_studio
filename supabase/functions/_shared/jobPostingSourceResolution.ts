/**
 * Job posting input adapters for Application Evaluations extraction.
 *
 * - manual_text: user paste (preferred when long enough)
 * - external_url: HTML fetch via ScrapingBee → plain text (no scraping for internal hosts)
 * - internal_posting: future — load from platform DB by id (see resolveInternalJobPostingPlainText)
 *
 * Downstream AI extraction should only consume `posting_text` from the resolved result.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type JobPostingSourceKind = "manual_text" | "external_url" | "internal_posting";

export type ResolvedJobPostingSource = {
  kind: JobPostingSourceKind;
  posting_text: string;
  /** Set when kind === "external_url" */
  fetched_url?: string;
  /** Set when kind === "internal_posting" */
  internal_posting_id?: string;
};

const MAX_POSTING_CHARS = 48_000;
const MIN_POSTING_CHARS = 40;

function htmlToText(html: string): string {
  let t = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  t = t.replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  t = t.replace(/\s+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  return t;
}

async function fetchHtmlViaScrapingBee(
  targetUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; status: number; html: string; error?: string }> {
  const u = new URL("https://app.scrapingbee.com/api/v1/");
  u.searchParams.set("api_key", apiKey);
  u.searchParams.set("url", targetUrl);
  u.searchParams.set("render_js", "false");

  const res = await fetch(u.toString(), { method: "GET" });
  const html = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      html: "",
      error: html?.slice(0, 400) || `${res.status} ${res.statusText}`,
    };
  }
  return { ok: true, status: res.status, html };
}

function normalizeHostname(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function isInternalJobUrl(url: URL, internalHosts: Set<string>): boolean {
  const h = normalizeHostname(url.hostname);
  return internalHosts.has(h);
}

function parseInternalHostsEnv(raw: string | undefined): Set<string> {
  const s = new Set<string>();
  if (!raw?.trim()) return s;
  for (const part of raw.split(",")) {
    const t = part
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0];
    if (t) s.add(normalizeHostname(t));
  }
  return s;
}

/** Remove obvious chrome lines when we have block-derived newlines */
function pruneBoilerplateText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!text.includes("\n")) {
    return normalized;
  }
  const parts = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const lineJunk =
    /^(accept|cookie|cookies|privacy policy|terms of (service|use)|sign in|log in|subscribe|menu|skip to|search jobs|©)/i;
  const kept = parts.filter((line) => {
    if (line.length < 12 && /^[^a-zA-Z]*$/.test(line)) return false;
    if (lineJunk.test(line.slice(0, 55))) return false;
    return true;
  });
  let out = kept.join(" ").replace(/\s+/g, " ").trim();
  if (out.length < MIN_POSTING_CHARS && normalized.length >= MIN_POSTING_CHARS) {
    out = normalized;
  }
  return out;
}

function clampPostingText(s: string): string {
  if (s.length <= MAX_POSTING_CHARS) return s;
  return `${s.slice(0, MAX_POSTING_CHARS)}\n…[truncated]`;
}

export type ResolveJobPostingInput = {
  raw_description: string | null | undefined;
  source_url: string | null | undefined;
  /** When set, use platform data — never scrape (future-ready). */
  internal_posting_id: string | null | undefined;
  scrapingBeeApiKey: string | null | undefined;
  /** Comma-separated hostnames; URLs on these hosts are not scraped. */
  internalJobHostsEnv: string | undefined;
  userClient: SupabaseClient;
};

/**
 * Future hook: load plain-text job body from Capability Studio listings using RLS.
 * Implement with e.g. .from("job_postings").select("description").eq("id", postingId).single()
 */
export async function resolveInternalJobPostingPlainText(
  _userClient: SupabaseClient,
  postingId: string,
): Promise<
  | { ok: true; text: string; internal_posting_id: string }
  | { ok: false; error: string }
> {
  void _userClient;
  void postingId;
  return {
    ok: false,
    error:
      "Internal job postings are not available yet. Paste the description, or use an external posting URL.",
  };
}

export async function resolveJobPostingPlainText(
  input: ResolveJobPostingInput,
): Promise<
  | { ok: true; resolved: ResolvedJobPostingSource }
  | { ok: false; status: number; error: string }
> {
  const internalHosts = parseInternalHostsEnv(input.internalJobHostsEnv);
  const internalId = input.internal_posting_id?.trim() || null;

  if (internalId) {
    const r = await resolveInternalJobPostingPlainText(input.userClient, internalId);
    if (!r.ok) {
      return { ok: false, status: 400, error: r.error };
    }
    const t = clampPostingText(r.text.trim());
    if (t.length < MIN_POSTING_CHARS) {
      return {
        ok: false,
        status: 400,
        error: "Internal posting did not yield enough text to analyse.",
      };
    }
    return {
      ok: true,
      resolved: {
        kind: "internal_posting",
        posting_text: t,
        internal_posting_id: r.internal_posting_id,
      },
    };
  }

  const manual = (input.raw_description ?? "").trim();
  if (manual.length >= MIN_POSTING_CHARS) {
    return {
      ok: true,
      resolved: {
        kind: "manual_text",
        posting_text: clampPostingText(manual),
      },
    };
  }

  const urlStr = input.source_url?.trim() || null;
  if (!urlStr) {
    return {
      ok: false,
      status: 400,
      error:
        "Add a job description (at least 40 characters) or a source URL to fetch from.",
    };
  }

  let pageUrl: URL;
  try {
    pageUrl = new URL(urlStr);
  } catch {
    return { ok: false, status: 400, error: "Source URL is not valid." };
  }
  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") {
    return { ok: false, status: 400, error: "Only http(s) URLs are supported." };
  }

  if (isInternalJobUrl(pageUrl, internalHosts)) {
    return {
      ok: false,
      status: 400,
      error:
        "This job URL is on your own platform — it is not fetched via scrape. Use an in-product action when available, or paste the posting text.",
    };
  }

  const key = input.scrapingBeeApiKey?.trim();
  if (!key) {
    return {
      ok: false,
      status: 503,
      error:
        "Fetching job pages needs ScrapingBee (SCRAPINGBEE_API_KEY). Paste the description instead, or ask your admin to configure ScrapingBee.",
    };
  }

  const fetchRes = await fetchHtmlViaScrapingBee(pageUrl.href, key);
  if (!fetchRes.ok) {
    console.error("jobPostingSourceResolution: ScrapingBee", fetchRes.error);
    return {
      ok: false,
      status: 502,
      error:
        "Could not download that URL. Paste the job description, or try again later.",
    };
  }

  let plain = htmlToText(fetchRes.html);
  plain = pruneBoilerplateText(plain);
  plain = clampPostingText(plain.replace(/\s+/g, " ").trim());

  if (plain.length < MIN_POSTING_CHARS) {
    return {
      ok: false,
      status: 400,
      error:
        "Could not extract enough text from that page. Paste the job description manually.",
    };
  }

  return {
    ok: true,
    resolved: {
      kind: "external_url",
      posting_text: plain,
      fetched_url: pageUrl.href,
    },
  };
}
