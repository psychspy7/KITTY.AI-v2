import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { ApiError, type Env, type Identity } from "./types";
const googleKeys = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);
export function identityFromClaims(
  payload: JWTPayload,
  now = Date.now() / 1000,
): Identity {
  const firebase = payload.firebase as
    { sign_in_provider?: string } | undefined;
  if (
    !payload.sub ||
    payload.sub.length > 128 ||
    !payload.iat ||
    payload.iat > now ||
    typeof payload.auth_time !== "number" ||
    payload.auth_time > now ||
    payload.email_verified !== true ||
    typeof payload.email !== "string" ||
    firebase?.sign_in_provider !== "google.com"
  ) {
    throw new ApiError(401, "Sign in with a verified Google account.");
  }
  return {
    uid: payload.sub,
    email: payload.email,
    authTime: payload.auth_time,
  };
}
export function isOwner(
  user: Identity,
  env: Pick<Env, "OWNER_UID" | "OWNER_EMAIL">,
): boolean {
  return (
    !!env.OWNER_UID &&
    user.uid === env.OWNER_UID &&
    user.email === env.OWNER_EMAIL
  );
}
export async function verifyToken(
  token: string,
  project: string,
  keys: JWTVerifyGetKey = googleKeys,
) {
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ["RS256"],
    audience: project,
    issuer: `https://securetoken.google.com/${project}`,
    requiredClaims: ["exp", "iat", "auth_time", "sub"],
  });
  return identityFromClaims(payload);
}
export async function authenticate(
  request: Request,
  env: Env,
): Promise<Identity> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer "))
    throw new ApiError(401, "Please sign in.");
  const token = header.slice(7);
  try {
    const identity = await verifyToken(token, env.FIREBASE_PROJECT_ID);
    // Check disabled accounts and revoked sessions; verification alone does not check revocation.
    if (!env.FIREBASE_WEB_API_KEY)
      throw new ApiError(503, "Firebase backend setup is incomplete.");
    const result = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!result.ok)
      throw new ApiError(401, "Your session expired. Sign in again.");
    const data = (await result.json()) as {
      users?: { localId: string; disabled?: boolean; validSince?: string }[];
    };
    const account = data.users?.[0];
    if (
      !account ||
      account.localId !== identity.uid ||
      account.disabled ||
      Number(account.validSince || 0) > identity.authTime
    )
      throw new ApiError(401, "Your session was revoked. Sign in again.");
    return identity;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "Unable to verify your session. Sign in again.");
  }
}
