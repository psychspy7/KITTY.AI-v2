import {
  readdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const excluded = new Set([
  "node_modules",
  "build",
  "dist",
  ".gradle",
  ".wrangler",
  ".git",
  ".tooling",
  ".kotlin",
  ".firebase",
]);
const privateNames = new Set([
  "local.properties",
  "google-services.json",
  "keystore.properties",
  ".dev.vars",
  ".vault-key.local",
  ".env.local",
  "kitty-icon-master.png",
]);
const approved = [
  "README.md",
  ".gitignore",
  ".gitattributes",
  ".firebaserc",
  "firebase.json",
  "package.json",
  "package-lock.json",
  ".github",
  "android",
  "admin",
  "backend",
  "scripts",
  "docs",
  "assets",
];
const text = [],
  binary = [];
function walk(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const name of readdirSync(path))
      if (!excluded.has(name)) walk(join(path, name));
    return;
  }
  if (
    privateNames.has(path.split(/[\\/]/).at(-1)) ||
    /\.(jks|keystore|apk|zip|log)$/.test(path)
  )
    return;
  const file = relative(root, path).replaceAll("\\", "/");
  if (/\.(png|webp|jar|wav|mp3)$/.test(file)) {
    binary.push({
      path: file,
      encoding: "base64",
      content: readFileSync(path).toString("base64"),
    });
  } else
    text.push({
      path: file,
      mode: file === "android/gradlew" ? "100755" : "100644",
      type: "blob",
      content: readFileSync(path, "utf8"),
    });
}
for (const entry of approved) walk(join(root, entry));
mkdirSync(join(root, ".tooling"), { recursive: true });
writeFileSync(
  join(root, ".tooling", "repository-manifest.json"),
  JSON.stringify({ text, binary }),
);
// Keep the configured local archive separate from the public GitHub export.
// Owner identities are setup values, not required public source metadata.
const ownerEmail = readFileSync(join(root, "backend/wrangler.toml"), "utf8")
  .match(/^OWNER_EMAIL\s*=\s*"([^"]+)"/m)?.[1];
const ownerUid = readFileSync(join(root, "docs/DEPLOYMENT.md"), "utf8")
  .match(/Exact owner UID: \*\*([^*]+)\*\*/)?.[1];
const publicText = text.map((entry) => {
  let content = entry.content;
  if (ownerEmail) content = content.replaceAll(ownerEmail, "owner@example.com");
  if (ownerUid) content = content.replaceAll(ownerUid, "OWNER_UID (set privately)");
  if (entry.path === "admin/src/main.ts")
    content = content.replace("<small>Owner: owner@example.com</small>", "<small>Owner account only</small>");
  if (entry.path === "README.md")
    content += "\n## Public source configuration\n\nThis GitHub export uses owner@example.com as an owner-email placeholder and omits the owner's exact Firebase UID. Before deploying this checkout, set OWNER_EMAIL in backend/wrangler.toml and the email constant in scripts/finish-firebase-setup.mjs to your verified owner account. Keep the exact OWNER_UID in Cloudflare Worker Secrets. The locally delivered source archive retains the configured owner values; the current deployed service remains configured.\n";
  return { ...entry, content };
});
writeFileSync(
  join(root, ".tooling", "repository-public-manifest.json"),
  JSON.stringify({ text: publicText, binary }),
);
console.log(
  `Prepared ${text.length} text files and ${binary.length} binary files. Private files excluded.`,
);
