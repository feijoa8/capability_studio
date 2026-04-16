import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Email OTP second factor (Phase 4).
 *
 * Security: JWT verification is enabled in `supabase/config.toml` (`verify_jwt = true`).
 * The client also sends `Authorization: Bearer <access_token>` so the function can resolve the user.
 *
 * Edge Function secrets:
 * - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — required for DB and admin user lookup.
 * - OTP_CODE_PEPPER — min 16 characters; never expose to clients.
 * - RESEND_API_KEY — required for sending email; no silent skip when missing.
 * - OTP_EMAIL_FROM — optional sender; default `auth@mail.capability.studio`.
 * - OTP_EXPIRY_MINUTES, OTP_RESEND_COOLDOWN_SECONDS, OTP_SESSION_DAYS — optional tuning.
 */

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action =
  | "start_enrollment"
  | "complete_enrollment"
  | "start_login"
  | "verify_login"
  | "resend"
  | "disable";

type Body = {
  action?: Action;
  code?: string;
  purpose?: "enroll" | "login";
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeJwtClaims(jwt: string): {
  sub?: string;
  role?: string;
  session_id?: string;
  iat?: number;
} {
  const parts = jwt.split(".");
  if (parts.length < 2) return {};
  let b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  try {
    const parsed = JSON.parse(atob(b64 + pad)) as Record<string, unknown>;
    const sub = typeof parsed.sub === "string" ? parsed.sub : undefined;
    const role = typeof parsed.role === "string" ? parsed.role : undefined;
    const session_id =
      typeof parsed.session_id === "string" ? parsed.session_id : undefined;
    const iat = typeof parsed.iat === "number" ? parsed.iat : undefined;
    return { sub, role, session_id, iat };
  } catch {
    return {};
  }
}

function log401(
  branch: string,
  ctx: {
    action?: Action;
    purpose?: "enroll" | "login";
    hasAuthHeader: boolean;
    hasAccessToken: boolean;
    jwtRole?: string;
    authUserId?: string;
    resolvedUserId?: string;
    resolvedUser: boolean;
    anonKeyPresent: boolean;
    serviceKeyPresent: boolean;
    mandatory?: boolean;
  },
) {
  console.error("[email-otp-2fa][401]", {
    branch,
    action: ctx.action ?? null,
    purpose: ctx.purpose ?? null,
    hasAuthHeader: ctx.hasAuthHeader,
    hasAccessToken: ctx.hasAccessToken,
    jwtRole: ctx.jwtRole ?? null,
    authUserId: ctx.authUserId ?? null,
    resolvedUser: ctx.resolvedUser,
    resolvedUserId: ctx.resolvedUserId ?? null,
    anonKeyPresent: ctx.anonKeyPresent,
    serviceKeyPresent: ctx.serviceKeyPresent,
    mandatory: ctx.mandatory ?? null,
  });
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomOtp(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(100000 + (n[0]! % 900000));
}

function sessionKeyFromAccessToken(accessToken: string): string {
  const parts = accessToken.split(".");
  if (parts.length < 2) return "invalid";
  let b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  try {
    const json = JSON.parse(atob(b64 + pad));
    if (json.session_id != null && json.session_id !== "") {
      return String(json.session_id);
    }
    return `${json.sub}:${json.iat ?? ""}`;
  } catch {
    return "invalid";
  }
}

async function sendOtpEmail(
  to: string,
  code: string,
  kind: "enroll" | "login",
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  const from =
    Deno.env.get("OTP_EMAIL_FROM")?.trim() ?? "auth@mail.capability.studio";
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Email delivery is not configured (RESEND_API_KEY). Add it in Edge Function secrets.",
    };
  }
  const subject =
    kind === "enroll"
      ? "Your Capability Studio security code"
      : "Your Capability Studio sign-in code";
  const text =
    `Your verification code is: ${code}\n\n` +
    `It expires in a few minutes. If you did not request this, you can ignore this message.\n`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const responseText = await res.text();
    console.error("[resend-error]", {
      status: res.status,
      body: responseText,
    });
    return { ok: false, error: responseText || res.statusText };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const pepper = Deno.env.get("OTP_CODE_PEPPER")?.trim();
  if (!pepper || pepper.length < 16) {
    return json(
      {
        error:
          "Server misconfiguration: OTP_CODE_PEPPER must be set (min 16 chars) on the email-otp-2fa function.",
      },
      503,
    );
  }

  let body: Body = {};
  let bodyParseFailed = false;
  try {
    body = (await req.json()) as Body;
  } catch {
    bodyParseFailed = true;
  }
  const action = body.action;
  const purpose = body.purpose;

  const authHeader = req.headers.get("Authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    log401("missing_authorization", {
      action,
      purpose,
      hasAuthHeader: Boolean(authHeader),
      hasAccessToken: false,
      jwtRole: null,
      authUserId: null,
      resolvedUser: false,
      anonKeyPresent: Boolean(Deno.env.get("SUPABASE_ANON_KEY") ?? ""),
      serviceKeyPresent: Boolean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""),
    });
    return json({ error: "Missing Authorization" }, 401);
  }

  const claims = safeJwtClaims(accessToken);
  const authUserId = claims.sub;

  const service = createClient(supabaseUrl, serviceKey);

  // Resolve user/email from JWT sub only (stable path; avoids anon-key auth.getUser / GoTrue JWT validation quirks).
  if (!authUserId) {
    log401("jwt_missing_sub", {
      action,
      purpose,
      hasAuthHeader: Boolean(authHeader),
      hasAccessToken: true,
      jwtRole: claims.role,
      authUserId,
      resolvedUser: false,
      anonKeyPresent: Boolean(Deno.env.get("SUPABASE_ANON_KEY") ?? ""),
      serviceKeyPresent: Boolean(serviceKey),
    });
    return json({ error: "Invalid session" }, 401);
  }
  if (!serviceKey) {
    log401("service_key_missing_for_admin_lookup", {
      action,
      purpose,
      hasAuthHeader: Boolean(authHeader),
      hasAccessToken: true,
      jwtRole: claims.role,
      authUserId,
      resolvedUser: false,
      anonKeyPresent: Boolean(Deno.env.get("SUPABASE_ANON_KEY") ?? ""),
      serviceKeyPresent: false,
    });
    return json({ error: "Server misconfiguration" }, 401);
  }
  const { data: adminUser, error: adminErr } = await service.auth.admin.getUserById(
    authUserId,
  );
  if (adminErr || !adminUser?.user) {
    log401("admin_get_user_failed", {
      action,
      purpose,
      hasAuthHeader: Boolean(authHeader),
      hasAccessToken: true,
      jwtRole: claims.role,
      authUserId,
      resolvedUser: false,
      anonKeyPresent: Boolean(Deno.env.get("SUPABASE_ANON_KEY") ?? ""),
      serviceKeyPresent: true,
    });
    return json({ error: adminErr?.message ?? "Invalid session" }, 401);
  }
  const user = { id: adminUser.user.id, email: adminUser.user.email };

  const email = user.email?.trim();
  if (!email) {
    return json({ error: "User has no email" }, 400);
  }

  if (bodyParseFailed) {
    return json({ error: "Invalid JSON" }, 400);
  }

  const expiryMin = Number(Deno.env.get("OTP_EXPIRY_MINUTES") ?? "10");
  const resendSec = Number(Deno.env.get("OTP_RESEND_COOLDOWN_SECONDS") ?? "60");
  const sessionDays = Number(Deno.env.get("OTP_SESSION_DAYS") ?? "14");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryMin * 60_000);
  const nextResend = new Date(now.getTime() + resendSec * 1000);

  async function invalidateOpenChallenges(
    uid: string,
    purpose: "enroll" | "login",
  ) {
    await service
      .from("user_second_factor_challenges")
      .update({ consumed_at: now.toISOString() })
      .eq("user_id", uid)
      .eq("purpose", purpose)
      .is("consumed_at", null);
  }

  async function findOpenChallenge(uid: string, purpose: "enroll" | "login") {
    const { data, error } = await service
      .from("user_second_factor_challenges")
      .select("*")
      .eq("user_id", uid)
      .eq("purpose", purpose)
      .is("consumed_at", null)
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown> | null;
  }

  try {
    if (!action) {
      return json({ error: "action required" }, 400);
    }
    if (action === "disable") {
      const { data: mandatory, error: mErr } = await service.rpc(
        "user_requires_mandatory_2fa",
        { p_user_id: user.id },
      );
      if (mErr) throw mErr;
      if (mandatory === true) {
        return json(
          {
            error:
              "Two-factor authentication cannot be turned off for your account type.",
          },
          403,
        );
      }
      await service.from("user_second_factor").upsert(
        {
          user_id: user.id,
          method: "email_otp",
          enabled: false,
          enrolled_at: null,
          updated_at: now.toISOString(),
        },
        { onConflict: "user_id" },
      );
      await service.from("user_second_factor_session").delete().eq(
        "user_id",
        user.id,
      );
      await invalidateOpenChallenges(user.id, "enroll");
      await invalidateOpenChallenges(user.id, "login");
      return json({ ok: true });
    }

    if (action === "start_enrollment") {
      await service.from("user_second_factor").upsert(
        {
          user_id: user.id,
          method: "email_otp",
          enabled: false,
          updated_at: now.toISOString(),
        },
        { onConflict: "user_id" },
      );
      await invalidateOpenChallenges(user.id, "enroll");
      const code = randomOtp();
      const codeHash = await hmacSha256Hex(pepper, code);
      const sent = await sendOtpEmail(email, code, "enroll");
      if (!sent.ok) {
        return json({ error: sent.error ?? "Email send failed" }, 503);
      }
      const { error: insErr } = await service
        .from("user_second_factor_challenges")
        .insert({
          user_id: user.id,
          purpose: "enroll",
          code_hash: codeHash,
          expires_at: expiresAt.toISOString(),
          attempt_count: 0,
          max_attempts: 5,
          next_resend_at: nextResend.toISOString(),
        });
      if (insErr) throw insErr;
      return json({
        ok: true,
        nextResendAt: nextResend.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
    }

    if (action === "complete_enrollment") {
      const code = (body.code ?? "").replace(/\D/g, "").trim();
      if (code.length !== 6) {
        return json({ error: "Enter the 6-digit code." }, 400);
      }
      const row = await findOpenChallenge(user.id, "enroll");
      if (!row) {
        return json(
          {
            error:
              "No active enrollment code. Start again or request a new code.",
          },
          400,
        );
      }
      if (new Date(String(row.expires_at)) <= now) {
        return json({ error: "This code has expired. Request a new one." }, 400);
      }
      const attempts = Number(row.attempt_count ?? 0);
      const maxA = Number(row.max_attempts ?? 5);
      if (attempts >= maxA) {
        return json(
          { error: "Too many incorrect attempts. Request a new code." },
          429,
        );
      }
      const expectedHash = String(row.code_hash);
      const gotHash = await hmacSha256Hex(pepper, code);
      if (expectedHash !== gotHash) {
        await service
          .from("user_second_factor_challenges")
          .update({ attempt_count: attempts + 1 })
          .eq("id", row.id);
        return json({ error: "That code is not correct." }, 400);
      }
      await service
        .from("user_second_factor_challenges")
        .update({ consumed_at: now.toISOString() })
        .eq("id", row.id);
      await service.from("user_second_factor").upsert(
        {
          user_id: user.id,
          method: "email_otp",
          enabled: true,
          enrolled_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: "user_id" },
      );
      const sk = sessionKeyFromAccessToken(accessToken);
      const until = new Date(now.getTime() + sessionDays * 86400_000);
      await service.from("user_second_factor_session").upsert(
        {
          user_id: user.id,
          session_key: sk,
          verified_until: until.toISOString(),
        },
        { onConflict: "user_id,session_key" },
      );
      return json({ ok: true, verifiedUntil: until.toISOString() });
    }

    if (action === "start_login") {
      const { data: row, error: sfErr } = await service
        .from("user_second_factor")
        .select("enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      if (sfErr) throw sfErr;
      if (!row?.enabled) {
        return json({ error: "Two-factor sign-in is not enabled for this account." }, 400);
      }
      await invalidateOpenChallenges(user.id, "login");
      const code = randomOtp();
      const codeHash = await hmacSha256Hex(pepper, code);
      const sent = await sendOtpEmail(email, code, "login");
      if (!sent.ok) {
        return json({ error: sent.error ?? "Email send failed" }, 503);
      }
      const { error: insErr } = await service
        .from("user_second_factor_challenges")
        .insert({
          user_id: user.id,
          purpose: "login",
          code_hash: codeHash,
          expires_at: expiresAt.toISOString(),
          attempt_count: 0,
          max_attempts: 5,
          next_resend_at: nextResend.toISOString(),
        });
      if (insErr) throw insErr;
      return json({
        ok: true,
        nextResendAt: nextResend.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
    }

    if (action === "verify_login") {
      const code = (body.code ?? "").replace(/\D/g, "").trim();
      if (code.length !== 6) {
        return json({ error: "Enter the 6-digit code." }, 400);
      }
      const row = await findOpenChallenge(user.id, "login");
      if (!row) {
        return json(
          {
            error:
              "No active sign-in code. Go back and send a new code.",
          },
          400,
        );
      }
      if (new Date(String(row.expires_at)) <= now) {
        return json({ error: "This code has expired. Request a new one." }, 400);
      }
      const attempts = Number(row.attempt_count ?? 0);
      const maxA = Number(row.max_attempts ?? 5);
      if (attempts >= maxA) {
        return json(
          { error: "Too many incorrect attempts. Request a new code." },
          429,
        );
      }
      const expectedHash = String(row.code_hash);
      const gotHash = await hmacSha256Hex(pepper, code);
      if (expectedHash !== gotHash) {
        await service
          .from("user_second_factor_challenges")
          .update({ attempt_count: attempts + 1 })
          .eq("id", row.id);
        return json({ error: "That code is not correct." }, 400);
      }
      await service
        .from("user_second_factor_challenges")
        .update({ consumed_at: now.toISOString() })
        .eq("id", row.id);
      const sk = sessionKeyFromAccessToken(accessToken);
      const until = new Date(now.getTime() + sessionDays * 86400_000);
      await service.from("user_second_factor_session").upsert(
        {
          user_id: user.id,
          session_key: sk,
          verified_until: until.toISOString(),
        },
        { onConflict: "user_id,session_key" },
      );
      return json({ ok: true, verifiedUntil: until.toISOString() });
    }

    if (action === "resend") {
      const purpose = body.purpose === "login" ? "login" : "enroll";
      const existing = await findOpenChallenge(user.id, purpose);
      if (!existing) {
        return json(
          { error: "No active code to resend. Start the flow again." },
          400,
        );
      }
      const nr = new Date(String(existing.next_resend_at));
      if (nr > now) {
        return json({
          ok: false,
          error: "Please wait before requesting another code.",
          nextResendAt: nr.toISOString(),
        });
      }
      await invalidateOpenChallenges(user.id, purpose);
      const code = randomOtp();
      const codeHash = await hmacSha256Hex(pepper, code);
      const sent = await sendOtpEmail(
        email,
        code,
        purpose === "login" ? "login" : "enroll",
      );
      if (!sent.ok) {
        return json({ error: sent.error ?? "Email send failed" }, 503);
      }
      const nextR = new Date(now.getTime() + resendSec * 1000);
      const { error: insErr } = await service
        .from("user_second_factor_challenges")
        .insert({
          user_id: user.id,
          purpose,
          code_hash: codeHash,
          expires_at: expiresAt.toISOString(),
          attempt_count: 0,
          max_attempts: 5,
          next_resend_at: nextR.toISOString(),
        });
      if (insErr) throw insErr;
      return json({
        ok: true,
        nextResendAt: nextR.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email-otp-2fa]", msg);
    return json({ error: msg }, 500);
  }
});
