import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
const root = new URL("../", import.meta.url);
const config = JSON.parse(readFileSync(new URL("admin/public/firebase-config.json", root), "utf8"));
const key = readFileSync(new URL("backend/.vault-key.local", root), "utf8").trim();
if (Buffer.from(key, "base64").length !== 32) throw new Error("Invalid vault key; preserve the original key.");
const path = new URL(".tooling/cloud-secrets.json", root);
try {
  writeFileSync(path, JSON.stringify({ VAULT_KEY: key, FIREBASE_WEB_API_KEY: config.apiKey }), { mode: 0o600 });
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "secret", "bulk", ".tooling/cloud-secrets.json", "--config", "backend/wrangler.toml"], { stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error("Secret upload failed.");
} finally { unlinkSync(path); }
