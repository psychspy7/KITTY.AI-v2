import assert from "node:assert/strict";
const url = process.argv[2] || "https://kitty-ai-v2.kitty-ai.workers.dev";
assert.equal(new URL(url).protocol, "https:");
const cases = [
  ["/api/health", 200, {}],
  ["/api/sync", 401, {}],
  ["/api/admin/config", 401, {}],
  ["/api/admin/providers", 401, { Authorization: "Bearer invalid-token" }],
  ["/api/me", 403, { Origin: "https://evil.example" }],
];
for (const [path, status, headers] of cases) {
  const response = await fetch(url + path, { headers, signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, status, path);
  const body = await response.json();
  assert.ok(path === "/api/health" ? body.service === "KITTY" : typeof body.error === "string");
  console.log(`PASS ${path}: HTTP ${status}`);
}
const page = await fetch(url, { signal: AbortSignal.timeout(20000) });
assert.equal(page.status, 200);
assert.match(await page.text(), /KITTY/);
console.log("PASS owner console static page: HTTP 200");
