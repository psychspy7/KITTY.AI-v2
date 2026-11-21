import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { membershipRoute, activeMembership, checkChatAccess, membershipStatus, reconcile } from "../src/memberships";
import { isFounder, isOwner, isFounderOrOwner, FOUNDER_EMAIL } from "../src/auth";
import { route } from "../src/index";
import type { Env, Identity } from "../src/types";

let mf: Miniflare, env: Env;
const founderUser: Identity = {
  uid: "founder-google-uid-1221",
  email: "viratanand1221@gmail.com",
  authTime: Date.now() / 1000,
};
const regularUser: Identity = {
  uid: "regular-user-uid-456",
  email: "user@example.com",
  authTime: Date.now() / 1000,
};
const gateway = "fixture-commerce-token-32-characters-long";
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

async function apiRequest(user: Identity, path: string, method = "GET", data?: unknown) {
  const r = new Request(`https://kitty.example/api/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  return route(r, env, ctx, async () => user);
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("OK")}}',
    d1Databases: ["DB"],
  });
  env = {
    DB: (await mf.getD1Database("DB")) as unknown as D1Database,
    OWNER_EMAIL: "viratanand1221@gmail.com",
    OWNER_UID: "founder-google-uid-1221",
    VAULT_KEY: btoa("12345678901234567890123456789012"),
    COMMERCE_GATEWAY_TOKEN: gateway,
    ALLOW_TEST_MEMBERSHIPS: "true",
    MEMBERSHIPS_FREE_WINDOW: "enabled",
    ASSETS: {} as Fetcher,
    FIREBASE_PROJECT_ID: "kittyai-f743c",
    RELEASE_REPOSITORY: "psychspy7/KITTY.AI-v2",
  };
  for (const file of ["0001.sql", "0005_memberships.sql"]) {
    for (const sql of readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)) {
      await env.DB.prepare(sql).run();
    }
  }
});

afterAll(async () => mf.dispose());

beforeEach(async () => {
  for (const t of ["commerce_grants", "commerce_payments", "commerce_webhooks", "commerce_orders", "free_chat_windows"]) {
    await env.DB.prepare("DELETE FROM " + t).run();
  }
});

describe("KITTY AI Permanent Founder & Developer Entitlements", () => {
  it("authenticates and validates founder identity accurately", () => {
    expect(isFounder(founderUser, env)).toBe(true);
    expect(isFounderOrOwner(founderUser, env)).toBe(true);
    expect(isOwner(founderUser, env)).toBe(true);

    // Case-insensitivity check for Gmail
    expect(isFounder({ ...founderUser, email: "ViratAnand1221@GMAIL.com" }, env)).toBe(true);

    // Regular users are rejected
    expect(isFounder(regularUser, env)).toBe(false);
    expect(isFounderOrOwner(regularUser, env)).toBe(false);
    expect(isOwner(regularUser, env)).toBe(false);

    // Similarly named emails cannot impersonate founder
    expect(isFounder({ ...founderUser, email: "viratanand1221@gmail.com.fake" }, env)).toBe(false);
    expect(isFounder({ ...founderUser, email: "virat@gmail.com" }, env)).toBe(false);
  });

  it("grants permanent complimentary premium status to founder with no payment or expiry (Year 9999)", async () => {
    const status = await membershipStatus(env, founderUser);
    expect(status.paid).toBe(true);
    expect(status.isFounder).toBe(true);
    expect(status.role).toBe("founder");
    expect(status.expiresAt).toBe(253402300799000); // Year 9999
    expect(status.freeRemainingSeconds).toBe(86400);
    expect(status.chatLimit).toBe(999999);
    expect(status.speechLimit).toBe(999999);
    expect(status.freeWindowEnabled).toBe(false);

    // Active membership check
    const active = await activeMembership(env, founderUser.uid, "kitty", founderUser);
    expect(active?.chat_limit).toBe(999999);
    expect(active?.speech_limit).toBe(999999);
    expect(active?.ends_at).toBe(253402300799000);
    expect(active?.isFounder).toBe(true);
    expect(active?.order_id).toBe("founder-complimentary");

    // Check chat access does not limit founder
    const chatAccess = await checkChatAccess(env, founderUser);
    expect(chatAccess?.chat_limit).toBe(999999);
    expect(chatAccess?.ends_at).toBe(253402300799000);

    // Verify /api/me response
    const meRes = await apiRequest(founderUser, "me", "GET");
    expect(meRes.status).toBe(200);
    const meData = (await meRes.json()) as any;
    expect(meData.isFounder).toBe(true);
    expect(meData.role).toBe("founder");
    expect(meData.admin).toBe(true);
  });

  it("ensures founder is completely immune to payment cancellations and refund webhooks", async () => {
    const terms = JSON.stringify({
      name: "KITTY Plus",
      amount: 9900,
      months: 1,
      chatLimit: 100,
      speechLimit: 10,
      approved: true,
      enabled: true,
      benefits: [],
    });

    // Insert order first to satisfy foreign key constraint
    await env.DB.prepare(
      "INSERT INTO commerce_orders (id, uid, product, plan_id, terms, mode, provider_order_id, provider_key_id, status, created_at, expires_at) VALUES (?, ?, 'kitty', 'kitty-plus', ?, 'live', 'order_founder_cancel', 'key1', 'captured', 0, 9999999999999)"
    ).bind("founder-test-order", founderUser.uid, terms).run();

    // Insert grant into commerce_grants referencing founder-test-order
    await env.DB.prepare(
      "INSERT INTO commerce_grants (order_id, payment_id, uid, product, mode, chat_limit, speech_limit, starts_at, ends_at, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)"
    ).bind("founder-test-order", "pay_founder_001", founderUser.uid, "kitty", "live", 999999, 999999, 0, 253402300799000).run();

    // Trigger refund reconciliation
    await reconcile(env, {
      orderId: "order_founder_cancel",
      paymentId: "pay_founder_001",
      amount: 9900,
      currency: "INR",
      captured: false,
      refunded: 9900,
      status: "refunded",
    });

    // Active status remains intact with year 9999 expiry
    const active = await activeMembership(env, founderUser.uid, "kitty", founderUser);
    expect(active?.ends_at).toBe(253402300799000);
    expect(active?.isFounder).toBe(true);

    const status = await membershipStatus(env, founderUser);
    expect(status.paid).toBe(true);
    expect(status.isFounder).toBe(true);
  });

  it("restricts non-founder users by paid plan and 5-min free window", async () => {
    const status = await membershipStatus(env, regularUser);
    expect(status.paid).toBe(false);
    expect(status.isFounder).toBeFalsy();
    expect(status.priceLabel).toBe("Rs99/month");
    expect(status.freeRemainingSeconds).toBe(300);

    // Initial checkChatAccess starts free window
    await checkChatAccess(env, regularUser);

    // Simulate window expiration
    await env.DB.prepare("UPDATE free_chat_windows SET started_at=? WHERE uid=?")
      .bind(Date.now() - 305000, regularUser.uid)
      .run();

    // Non-founder is restricted with 429 FREE_WINDOW_ENDED
    await expect(checkChatAccess(env, regularUser)).rejects.toMatchObject({
      status: 429,
      code: "FREE_WINDOW_ENDED",
    });

    // Founder is never restricted even when window elapsed
    const founderAccess = await checkChatAccess(env, founderUser);
    expect(founderAccess?.ends_at).toBe(253402300799000);
  });

  it("rejects non-founder users from developer testing endpoint with 403 Forbidden", async () => {
    // Non-founder GET /api/admin/developer-testing -> 403
    await expect(apiRequest(regularUser, "admin/developer-testing", "GET")).rejects.toMatchObject({
      status: 403,
    });

    // Non-founder GET /api/developer/testing -> 403
    await expect(apiRequest(regularUser, "developer/testing", "GET")).rejects.toMatchObject({
      status: 403,
    });

    // Non-founder POST /api/admin/developer-testing -> 403
    await expect(
      apiRequest(regularUser, "admin/developer-testing", "POST", { action: "diagnostics" })
    ).rejects.toMatchObject({
      status: 403,
    });
  });

  it("allows founder full access to developer testing controls, diagnostics, system prompts, and moderation", async () => {
    // Founder GET developer testing
    const getRes = await apiRequest(founderUser, "admin/developer-testing", "GET");
    expect(getRes.status).toBe(200);
    const getData = (await getRes.json()) as any;
    expect(getData.status).toBe("ok");
    expect(getData.mode).toBe("developer-testing");
    expect(getData.founder.isFounder).toBe(true);
    expect(getData.diagnostics.database).toBe("healthy");
    expect(getData.systemPrompts.currentCorePrompt).toBeDefined();
    expect(getData.modelConfigs.supportedProviders).toContain("gemini");
    expect(getData.modelConfigs.supportedProviders).toContain("groq");
    expect(getData.moderationSettings.piiFilterEnabled).toBe(true);

    // Founder POST test_moderation
    const modRes = await apiRequest(founderUser, "admin/developer-testing", "POST", {
      action: "test_moderation",
      inputText: "Secret key rzp_test_1234567890 and email test@gmail.com",
    });
    expect(modRes.status).toBe(200);
    const modData = (await modRes.json()) as any;
    expect(modData.passed).toBe(true);
    expect(modData.flaggedPii).toContain("email_detected");
    expect(modData.flaggedPii).toContain("secret_api_key_detected");
    expect(modData.filteredText).toContain("[REDACTED_KEY]");
    expect(modData.filteredText).toContain("[REDACTED_EMAIL]");

    // Founder POST test_prompt
    const promptRes = await apiRequest(founderUser, "admin/developer-testing", "POST", {
      action: "test_prompt",
      systemPrompt: "You are KITTY test prompt.",
      inputText: "Hello",
    });
    expect(promptRes.status).toBe(200);
    const promptData = (await promptRes.json()) as any;
    expect(promptData.action).toBe("test_prompt");
    expect(promptData.status).toBe("ready");

    // Founder POST test_model
    const modelRes = await apiRequest(founderUser, "developer/testing", "POST", {
      action: "test_model",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
    });
    expect(modelRes.status).toBe(200);
    const modelData = (await modelRes.json()) as any;
    expect(modelData.status).toBe("simulated_success");
    expect(modelData.provider).toBe("groq");
  });
});
