import { z } from "zod";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ApiError, type Env, type Identity } from "./types";
import { seal, unseal } from "./vault";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const sessionId = z.string().uuid();
const proof = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store" },
});
export async function challenge(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export async function verifyGoogleCredential(token: string, email: string, clientId: string, keys: JWTVerifyGetKey = googleKeys) {
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"], audience: clientId,
      issuer: ["accounts.google.com", "https://accounts.google.com"],
      requiredClaims: ["exp", "iat", "sub"],
    });
    if (payload.email_verified !== true || payload.email !== email)
      throw new Error("Account mismatch");
  } catch {
    throw new ApiError(401, "Google could not verify this sign-in. Please try again.");
  }
}
export async function startBrowserLogin(request: Request, env: Env, data: unknown) {
  const input = z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(data);
  // A keyed hash limits anonymous requests without recording the IP address.
  const origin = await challenge(`${env.VAULT_KEY}:${request.headers.get("CF-Connecting-IP") || "local"}`);
  const day = new Date().toISOString().slice(0, 10);
  const allowance = await env.DB.prepare(
    "INSERT INTO usage(uid,day,kind,count) VALUES(?,?,'browser-login',1) ON CONFLICT(uid,day,kind) DO UPDATE SET count=count+1 WHERE count < 30 RETURNING count",
  ).bind(`login-${origin}`, day).first();
  if (!allowance) throw new ApiError(429, "Too many sign-in attempts. Please try again later.");
  await env.DB.prepare("DELETE FROM browser_logins WHERE expires_at <= ?").bind(Date.now()).run();
  const id = crypto.randomUUID(), expiresAt = Date.now() + 600_000;
  await env.DB.prepare("INSERT INTO browser_logins(id,challenge,expires_at) VALUES(?,?,?)")
    .bind(id, input.challenge, expiresAt).run();
  return json({ id, expiresAt });
}
export async function browserLoginStatus(env: Env, data: unknown, cancel = false) {
  const input = z.object({ id: sessionId, verifier: proof }).strict().parse(data);
  const row = await env.DB.prepare("SELECT challenge,expires_at,encrypted_credential,uid FROM browser_logins WHERE id=?")
    .bind(input.id).first<{challenge:string;expires_at:number;encrypted_credential:string|null;uid:string|null}>();
  if (!row || row.expires_at <= Date.now() || row.challenge !== await challenge(input.verifier))
    throw new ApiError(404, "This sign-in has expired. Open a new sign-in from KITTY.");
  if (cancel) {
    await env.DB.prepare("DELETE FROM browser_logins WHERE id=?").bind(input.id).run();
    return json({ cancelled: true });
  }
  if (!row.encrypted_credential) return json({ pending: true }, 202);
  // Consume atomically: even simultaneous requests cannot replay a completed handoff.
  const claimed = await env.DB.prepare("DELETE FROM browser_logins WHERE id=? AND challenge=? AND expires_at>? RETURNING encrypted_credential,uid")
    .bind(input.id, row.challenge, Date.now()).first<{encrypted_credential:string;uid:string}>();
  if (!claimed) throw new ApiError(409, "This sign-in was already completed.");
  return json({ googleIdToken: await unseal(claimed.encrypted_credential, env.VAULT_KEY, `login:${input.id}`), uid: claimed.uid });
}
export async function completeBrowserLogin(env: Env, user: Identity, data: unknown, verify = verifyGoogleCredential) {
  const input = z.object({ id: sessionId, googleIdToken: z.string().min(100).max(12000) }).strict().parse(data);
  if (!env.GOOGLE_WEB_CLIENT_ID) throw new ApiError(503, "Browser sign-in is not configured.");
  await verify(input.googleIdToken, user.email, env.GOOGLE_WEB_CLIENT_ID);
  const encrypted = await seal(input.googleIdToken, env.VAULT_KEY, `login:${input.id}`);
  const saved = await env.DB.prepare("UPDATE browser_logins SET encrypted_credential=?,uid=? WHERE id=? AND expires_at>? AND encrypted_credential IS NULL RETURNING id")
    .bind(encrypted, user.uid, input.id, Date.now()).first();
  if (!saved) throw new ApiError(409, "This sign-in expired or was already completed. Open KITTY and try again.");
  return json({ completed: true });
}
