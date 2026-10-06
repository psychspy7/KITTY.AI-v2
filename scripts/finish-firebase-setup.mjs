import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
process.env.XDG_CONFIG_HOME = join(root, ".tooling/account-config");
const cache = join(root, ".tooling/npm-cache/_npx");
// Use the already-installed official CLI's credential refresh and authenticated HTTP client.
// No tokens are copied into source, command arguments or terminal output.
const cliRoot = readdirSync(cache).map(n => join(cache, n, "node_modules/firebase-tools")).find(p => existsSync(join(p, "lib/auth.js")));
if (!cliRoot) throw new Error("Run finish-firebase-signin.ps1 first.");
const require = createRequire(import.meta.url);
const auth = require(join(cliRoot, "lib/auth.js"));
const { requireAuth } = require(join(cliRoot, "lib/requireAuth.js"));
const { Client } = require(join(cliRoot, "lib/apiv2.js"));
const apps = require(join(cliRoot, "lib/management/apps.js"));
const project = "kittyai-f743c", app = "1:34203306703:android:1e32ba3a8c58a622d485ba";
const email = "viratanand1221@gmail.com", domain = "kitty-ai-v2.kitty-ai.workers.dev";
const account = auth.getGlobalDefaultAccount();
if (!account || account.user?.email !== email) throw new Error("Sign into the Firebase CLI as the exact owner email first.");
await requireAuth({ project, nonInteractive: true, user: account.user, tokens: account.tokens });
const api = new Client({ urlPrefix: "https://identitytoolkit.googleapis.com", auth: true });
const path = `/admin/v2/projects/${project}/config`;
const original = (await api.get(path)).body;
const domains = [...new Set([...(original.authorizedDomains || []), domain])];
if (!original.authorizedDomains?.includes(domain)) {
  await api.patch(path, { authorizedDomains: domains }, { queryParams: { updateMask: "authorizedDomains" } });
}
if (!(await api.get(path)).body.authorizedDomains?.includes(domain)) throw new Error("Authorized-domain verification failed.");
console.log("PASS Worker hostname authorized; existing Firebase domains preserved.");
const fingerprints = [
  ["e35928b853a88296450c3ce2cc879f4d9a6a4836", "SHA_1"],
  ["047129a730f0686d4f83f1d89d690811f5d7f91e09cd283cb9fdfff0a14661d1", "SHA_256"],
];
const certificates = await apps.listAppAndroidSha(project, app);
for (const [shaHash, certType] of fingerprints) {
  if (!certificates.some(c => c.shaHash.replaceAll(":", "").toLowerCase() === shaHash)) {
    await apps.createAppAndroidSha(project, app, { shaHash, certType });
  }
}
const verified = await apps.listAppAndroidSha(project, app);
if (!fingerprints.every(([sha]) => verified.some(c => c.shaHash.replaceAll(":", "").toLowerCase() === sha))) throw new Error("Signing certificate verification failed.");
console.log("PASS release SHA-1 and SHA-256 registered for the existing Android app.");
const response = await api.post(`/v1/projects/${project}/accounts:lookup`, { email: [email] }, { skipLog: { body: true, resBody: true } });
const user = response.body.users?.find(u => u.email === email);
if (!user || !user.emailVerified || user.disabled || !user.providerUserInfo?.some(p => p.providerId === "google.com")) {
  console.log("Owner activation pending: sign into the deployed KITTY console with the owner Google account, then rerun this helper.");
  process.exitCode = 2;
} else {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(user.localId)) throw new Error("Unexpected Firebase UID format; check the owner record manually.");
  if (process.argv[2] && user.localId !== process.argv[2]) throw new Error("The provided UID does not match the verified Google owner record. Owner secret was not changed.");
  const secretFile = join(root, ".tooling/owner-activation.json");
  try {
    writeFileSync(secretFile, JSON.stringify({ OWNER_UID: user.localId }), { mode: 0o600 });
    const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "secret", "bulk", secretFile, "--config", "backend/wrangler.toml"], { stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
    if (result.error || result.status !== 0) throw new Error("Cloudflare owner activation failed.");
  } finally { if (existsSync(secretFile)) unlinkSync(secretFile); }
  writeFileSync(join(root, ".tooling/firebase-setup-status.json"), JSON.stringify({ project, app, domains, ownerActivated: true, checkedAt: new Date().toISOString() }));
  console.log("PASS exact verified Google owner UID activated on the backend. Sign into the console to configure your provider keys.");
}
