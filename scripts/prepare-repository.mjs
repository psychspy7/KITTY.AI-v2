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
  if (/\.(png|webp|jar)$/.test(file)) {
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
console.log(
  `Prepared ${text.length} text files and ${binary.length} binary files. Private files excluded.`,
);
