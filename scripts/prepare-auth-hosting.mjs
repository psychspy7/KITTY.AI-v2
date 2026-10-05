import { mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const out = ".tooling/firebase-auth-hosting";
mkdirSync(out, { recursive:true });
for (const file of ["phone-login.html", "firebase-config.json", "kitty-icon.png"])
  copyFileSync(`admin/dist/${file}`, `${out}/${file}`);
mkdirSync(`${out}/assets`, {recursive:true});
for (const file of readdirSync("admin/dist/assets")) if (!file.startsWith("console-"))
  copyFileSync(`admin/dist/assets/${file}`, `${out}/assets/${file}`);
const config=JSON.parse(readFileSync(`${out}/firebase-config.json`, "utf8"));
config.authDomain="kittyai-f743c.firebaseapp.com";
writeFileSync(`${out}/firebase-config.json`,JSON.stringify(config));
writeFileSync(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>KITTY Sign-in</title><p>Start browser sign-in from the KITTY Android app.</p>');
console.log("Prepared the Firebase Google redirect page; no admin console, APK or secrets included.");
