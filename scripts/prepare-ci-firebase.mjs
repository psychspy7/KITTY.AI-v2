import { readFileSync, writeFileSync } from "node:fs";
const config = JSON.parse(
  readFileSync(
    new URL("../admin/public/firebase-config.json", import.meta.url),
    "utf8",
  ),
);
if (!config.apiKey || !config.webClientId)
  throw new Error(
    "Missing validated public Firebase config. Run scripts/validate-firebase.mjs locally.",
  );
// Public app identifiers, also recoverable from the APK. No provider or service-account secrets.
const android = {
  project_info: { project_number: "34203306703", project_id: "kittyai-f743c" },
  client: [
    {
      client_info: {
        mobilesdk_app_id: "1:34203306703:android:1e32ba3a8c58a622d485ba",
        android_client_info: { package_name: "com.kitty.ai" },
      },
      oauth_client: [{ client_id: config.webClientId, client_type: 3 }],
      api_key: [{ current_key: config.apiKey }],
      services: {
        appinvite_service: {
          other_platform_oauth_client: [
            { client_id: config.webClientId, client_type: 3 },
          ],
        },
      },
    },
  ],
  configuration_version: "1",
};
writeFileSync(
  new URL("../android/app/google-services.json", import.meta.url),
  JSON.stringify(android, null, 2),
);
console.log(
  "Created minimal CI Firebase Android config from validated public app identifiers. Registering a device signing certificate still requires Firebase project access.",
);
