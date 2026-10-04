import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
const path = new URL("../backend/.vault-key.local", import.meta.url);
if (existsSync(path))
  throw new Error(
    "Existing vault key preserved. Use it; rotating requires re-encrypting all provider keys.",
  );
writeFileSync(path, randomBytes(32).toString("base64"), { mode: 0o600 });
console.log(
  "Saved backend/.vault-key.local. Upload securely using: Get-Content backend/.vault-key.local | npx.cmd wrangler secret put VAULT_KEY --config backend/wrangler.toml",
);
