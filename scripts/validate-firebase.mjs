import { readFileSync, writeFileSync } from "node:fs";
const path = new URL("../android/app/google-services.json", import.meta.url);
const data = JSON.parse(readFileSync(path, "utf8"));
const client = data.client?.find(
  (c) => c.client_info?.android_client_info?.package_name === "com.kitty.ai",
);
if (
  data.project_info?.project_id !== "kittyai-f743c" ||
  String(data.project_info?.project_number) !== "34203306703" ||
  client?.client_info?.mobilesdk_app_id !==
    "1:34203306703:android:1e32ba3a8c58a622d485ba"
)
  throw new Error("Firebase project, package or App ID mismatch.");
if (!client.oauth_client?.some((c) => c.client_type === 3))
  throw new Error(
    "Missing Web OAuth client: enable Google sign-in and fetch a fresh config.",
  );
writeFileSync(
  new URL("../admin/public/firebase-config.json", import.meta.url),
  JSON.stringify(
    {
      apiKey: client.api_key[0].current_key,
      authDomain: "kittyai-f743c.firebaseapp.com",
      projectId: "kittyai-f743c",
      webClientId: client.oauth_client.find((c) => c.client_type === 3)
        .client_id,
    },
    null,
    2,
  ),
);
console.log(
  "Validated project, project number, Android App ID, package and Web OAuth client. Wrote public admin auth config; no provider secrets are present.",
);
