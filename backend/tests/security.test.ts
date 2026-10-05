import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { identityFromClaims, isOwner, verifyToken } from "../src/auth";
import { seal, unseal } from "../src/vault";
import { sseData, speech } from "../src/providers";
import { route, trustedRelease } from "../src/index";
import { DEFAULT_CONFIG, relevantMemories } from "../src/config";
import type { Env, Identity } from "../src/types";
let mf: Miniflare, env: Env;
let pending: Promise<unknown>[] = [];
const owner = {
  uid: "owner-uid",
  email: "viratanand1221@gmail.com",
  authTime: 1,
};
const alice = { uid: "alice", email: "alice@example.com", authTime: 1 };
const bob = { uid: "bob", email: "bob@example.com", authTime: 1 };
const ctx = {
  waitUntil: (p: Promise<unknown>) => {
    pending.push(p);
  },
  passThroughOnException() {},
} as ExecutionContext;
async function request(
  user: Identity,
  path: string,
  method = "GET",
  data?: unknown,
) {
  const r = new Request(`https://kitty.example/api/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  return route(r, env, ctx, async () => user);
}
const enabled = {
  ...DEFAULT_CONFIG,
  enabled: true,
  chatProviders: ["groq-main"],
  dailyChatLimit: 2,
};
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("OK")}}',
    d1Databases: ["DB"],
  });
  const db = await mf.getD1Database("DB");
  env = {
    DB: db as unknown as D1Database,
    ASSETS: { fetch: async () => new Response("asset") } as Fetcher,
    OWNER_UID: owner.uid,
    OWNER_EMAIL: owner.email,
    FIREBASE_PROJECT_ID: "kittyai-f743c",
    VAULT_KEY: btoa("12345678901234567890123456789012"),
    RELEASE_REPOSITORY: "psychspy7/KITTY.AI-v2",
  };
  for (const sql of readFileSync(
    new URL("../migrations/0001.sql", import.meta.url),
    "utf8",
  )
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await env.DB.prepare(sql).run();
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  pending = [];
  for (const table of [
    "examples",
    "messages",
    "requests",
    "conversations",
    "memories",
    "usage",
    "profiles",
    "providers",
    "settings",
    "announcements",
    "notice_reads",
    "audit",
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
});
async function ready() {
  await env.DB.prepare("INSERT INTO settings VALUES(1,?)")
    .bind(JSON.stringify(enabled))
    .run();
  await env.DB.prepare("INSERT INTO providers VALUES(?,?,?,?,?)")
    .bind(
      "groq-main",
      "groq",
      "openai/gpt-oss-120b",
      1,
      await seal("test-provider-key", env.VAULT_KEY, "groq-main"),
    )
    .run();
}
function providerStream(text = "Hi Sir.") {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
describe("verified identity and owner boundary", () => {
  it("fails closed without an exact UID and exact email", () => {
    expect(isOwner(owner, env)).toBe(true);
    expect(isOwner(owner, { OWNER_EMAIL: owner.email, OWNER_UID: "" })).toBe(
      false,
    );
    expect(isOwner({ ...owner, uid: "different" }, env)).toBe(false);
    expect(isOwner({ ...owner, email: "Viratanand1221@gmail.com" }, env)).toBe(
      false,
    );
  });
  it("rejects unverified and non-Google identities", () => {
    const claims = {
      sub: "a",
      iat: 1,
      auth_time: 1,
      email: "a@example.com",
      email_verified: true,
      firebase: { sign_in_provider: "google.com" },
    };
    expect(identityFromClaims(claims).uid).toBe("a");
    expect(() =>
      identityFromClaims({ ...claims, email_verified: false }),
    ).toThrow();
    expect(() =>
      identityFromClaims({
        ...claims,
        firebase: { sign_in_provider: "password" },
      }),
    ).toThrow();
  });
  it("checks signed token audience, expiration and issuer", async () => {
    const pair = await generateKeyPair("RS256");
    const jwk = await exportJWK(pair.publicKey);
    jwk.kid = "test";
    const keys = createLocalJWKSet({ keys: [jwk] });
    const sign = (
      aud = "kittyai-f743c",
      exp = "1h",
      issuer = "https://securetoken.google.com/kittyai-f743c",
    ) =>
      new SignJWT({
        email: owner.email,
        email_verified: true,
        auth_time: Math.floor(Date.now() / 1000),
        firebase: { sign_in_provider: "google.com" },
      })
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .setSubject(owner.uid)
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(aud)
        .setExpirationTime(exp)
        .sign(pair.privateKey);
    expect((await verifyToken(await sign(), "kittyai-f743c", keys)).uid).toBe(
      owner.uid,
    );
    await expect(
      verifyToken(await sign("wrong-project"), "kittyai-f743c", keys),
    ).rejects.toThrow();
    await expect(
      verifyToken(await sign("kittyai-f743c", "-1h"), "kittyai-f743c", keys),
    ).rejects.toThrow();
    await expect(
      verifyToken(
        await sign("kittyai-f743c", "1h", "https://attacker.example"),
        "kittyai-f743c",
        keys,
      ),
    ).rejects.toThrow();
  });
  it("denies admin routes even for another verified Google user", async () => {
    await expect(request(alice, "admin/config")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      request({ ...owner, uid: "imposter" }, "admin/providers"),
    ).rejects.toMatchObject({ status: 403 });
  });
});
describe("vault and account data", () => {
  it("encrypts keys and binds ciphertext to a provider ID", async () => {
    const encrypted = await seal("super-secret", env.VAULT_KEY, "groq-main");
    expect(encrypted).not.toContain("super-secret");
    expect(await unseal(encrypted, env.VAULT_KEY, "groq-main")).toBe(
      "super-secret",
    );
    await expect(
      unseal(encrypted, env.VAULT_KEY, "other-provider"),
    ).rejects.toThrow();
  });
  it("never returns saved provider keys", async () => {
    await request(owner, "admin/providers", "PUT", {
      id: "groq-main",
      kind: "groq",
      model: "openai/gpt-oss-120b",
      enabled: true,
      key: "super-secret",
    });
    const body = await (await request(owner, "admin/providers")).text();
    expect(body).not.toContain("super-secret");
    expect(body).not.toContain("encrypted_key");
  });
  it("isolates memories and conversations by authenticated UID", async () => {
    await request(alice, "memories", "PUT", {
      id: "same",
      text: "Alice private",
    });
    expect(await (await request(bob, "memories")).json()).toEqual([]);
    await request(bob, "memories/same", "DELETE");
    expect(
      ((await (await request(alice, "memories")).json()) as unknown[]).length,
    ).toBe(1);
    await env.DB.prepare("INSERT INTO conversations VALUES(?,?,?,?)")
      .bind(alice.uid, "secret", "Private", 1)
      .run();
    expect(await (await request(bob, "conversations")).json()).toEqual([]);
  });
});
describe("Gemini speech contract", () => {
  it("requests a private audio interaction and extracts WAV output", async () => {
    const provider = {
      id: "gemini-speech",
      kind: "gemini" as const,
      model: "gemini-3.8-flash-lite-tts",
      enabled: 1,
      encrypted_key: await seal(
        "speech-test-key",
        env.VAULT_KEY,
        "gemini-speech",
      ),
    };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        steps: [
          {
            type: "model_output",
            content: [
              { type: "audio", data: "UklGRg==", mime_type: "audio/wav" },
            ],
          },
        ],
      }),
    );
    expect(
      await speech(
        provider,
        env,
        "Hello Sir.",
        "gemini-3.8-flash-lite-tts",
        "Kore",
        new AbortController().signal,
      ),
    ).toEqual({ data: "UklGRg==", mimeType: "audio/wav" });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
    );
    const payload = JSON.parse(String(options?.body));
    expect(payload.store).toBe(false);
    expect(payload.response_format).toEqual({ type: "audio" });
    expect(payload.generation_config.speech_config).toEqual([
      { voice: "Kore" },
    ]);
    expect(payload.input[0].content[0].text).toBe("Hello Sir.");
  });
  it("rejects unsupported audio instead of playing it as WAV", async () => {
    const provider = {
      id: "gemini-speech",
      kind: "gemini" as const,
      model: "gemini-3.8-flash-lite-tts",
      enabled: 1,
      encrypted_key: await seal(
        "speech-test-key",
        env.VAULT_KEY,
        "gemini-speech",
      ),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        steps: [
          {
            type: "model_output",
            content: [
              { type: "audio", data: "audio", mime_type: "audio/mpeg" },
            ],
          },
        ],
      }),
    );
    await expect(
      speech(
        provider,
        env,
        "Hello",
        "gemini-3.8-flash-lite-tts",
        "Kore",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 502 });
  });
});
describe("streaming reliability, consent and limits", () => {
  it("retrieves Hindi memories with combining vowel marks intact", () => {
    expect(
      relevantMemories("मेरा नाम याद है?", [
        { text: "मेरा नाम Virat है." },
        { text: "Unrelated example" },
      ]),
    ).toEqual(["मेरा नाम Virat है."]);
  });
  it("parses UTF-8 across network chunks", async () => {
    const bytes = new TextEncoder().encode('data: {"text":"नमस्ते 😼"}\n\n');
    let n = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (n < bytes.length) c.enqueue(bytes.slice(n, (n += 3)));
        else c.close();
      },
    });
    const events = [];
    for await (const event of sseData(stream)) events.push(event);
    expect(JSON.parse(events[0]).text).toBe("नमस्ते 😼");
  });
  it("replays a completed request without a second provider call", async () => {
    await ready();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(providerStream());
    const input = { requestId: "req-1", conversationId: "chat-1", text: "Hi" };
    const first = await request(owner, "chat", "POST", input);
    expect(await first.text()).toContain("Hi Sir.");
    await Promise.all(pending);
    const replay = await request(owner, "chat", "POST", input);
    expect(await replay.text()).toContain("Hi Sir.");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM messages").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(2);
    await expect(
      request(owner, "chat", "POST", { ...input, text: "different" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("enforces per-user usage caps", async () => {
    await ready();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      providerStream(),
    );
    for (let i = 1; i <= 2; i++) {
      await (
        await request(alice, "chat", "POST", {
          requestId: `r-${i}`,
          conversationId: "c",
          text: "Hi",
        })
      ).text();
      await Promise.all(pending);
    }
    await expect(
      request(alice, "chat", "POST", {
        requestId: "r-3",
        conversationId: "c",
        text: "Hi",
      }),
    ).rejects.toMatchObject({ status: 429 });
  });
  it("requires consent and explicit selection, and removes examples on withdrawal", async () => {
    await ready();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(providerStream("Answer"));
    await (
      await request(alice, "chat", "POST", {
        requestId: "r",
        conversationId: "c",
        text: "Question",
      })
    ).text();
    await Promise.all(pending);
    expect(await (await request(owner, "admin/examples")).json()).toEqual([]);
    await expect(
      request(alice, "examples", "POST", { messageId: "r-a" }),
    ).rejects.toMatchObject({ status: 403 });
    await request(alice, "consent", "PUT", { consent: true });
    await request(alice, "examples", "POST", { messageId: "r-a" });
    expect(
      ((await (await request(owner, "admin/examples")).json()) as unknown[])
        .length,
    ).toBe(1);
    await request(alice, "consent", "PUT", { consent: false });
    expect(await (await request(owner, "admin/examples")).json()).toEqual([]);
  });
  it("rejects untrusted update sources", () => {
    const valid = "https://github.com/psychspy7/KITTY.AI-v2/releases/download/v1/kitty.apk";
    for (const invalid of [valid + "?download=1", valid + "#fragment", valid.replace("v1/kitty", "v1/extra/kitty"), valid.replace("github.com", "github.com:8443"), valid.replace("KITTY.AI-v2", "KITTYxAI-v2")]) {
      expect(trustedRelease(invalid, env.RELEASE_REPOSITORY)).toBe(false);
    }
    expect(
      trustedRelease(
        "https://github.com/psychspy7/KITTY.AI-v2/releases/download/v1/kitty.apk",
        env.RELEASE_REPOSITORY,
      ),
    ).toBe(true);
    expect(
      trustedRelease(
        "https://github.com/attacker/repo/releases/download/v1/a.apk",
        env.RELEASE_REPOSITORY,
      ),
    ).toBe(false);
    expect(
      trustedRelease(
        "https://github.com.evil.test/psychspy7/KITTY.AI-v2/releases/download/v1/a.apk",
        env.RELEASE_REPOSITORY,
      ),
    ).toBe(false);
  });
  it("requires a valid APK checksum when publishing an update", async () => {
    const release = { versionCode: 3, versionName: "1.0.2", url: "https://github.com/psychspy7/KITTY.AI-v2/releases/download/v1.0.2/kitty.apk", sha256: "", notes: "Update" };
    await expect(request(owner, "admin/config", "PUT", { ...DEFAULT_CONFIG, release })).rejects.toThrow("SHA-256");
    await expect(request(owner, "admin/config", "PUT", { ...DEFAULT_CONFIG, release: { ...release, sha256: "z".repeat(64) } })).rejects.toThrow();
    expect((await request(owner, "admin/config", "PUT", { ...DEFAULT_CONFIG, release: { ...release, sha256: "a".repeat(64) } })).status).toBe(200);
    expect(await (await request(alice, "update")).json()).toMatchObject({ sha256: "a".repeat(64), versionCode: 3 });
  });
  it("falls back only before any visible text", async () => {
    await ready();
    await env.DB.prepare("UPDATE settings SET data=? WHERE id=1")
      .bind(
        JSON.stringify({
          ...enabled,
          chatProviders: ["groq-main", "groq-fast"],
        }),
      )
      .run();
    await env.DB.prepare("INSERT INTO providers VALUES(?,?,?,?,?)")
      .bind(
        "groq-fast",
        "groq",
        "openai/gpt-oss-20b",
        1,
        await seal("fallback-test-key", env.VAULT_KEY, "groq-fast"),
      )
      .run();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(providerStream("Fallback answer"));
    const response = await request(alice, "chat", "POST", {
      requestId: "fallback",
      conversationId: "c",
      text: "Hi",
    });
    expect(await response.text()).toContain("Fallback answer");
    await Promise.all(pending);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps a partial reply and never starts a fallback after text", async () => {
    await ready();
    await env.DB.prepare("UPDATE settings SET data=? WHERE id=1")
      .bind(
        JSON.stringify({
          ...enabled,
          chatProviders: ["groq-main", "groq-fast"],
        }),
      )
      .run();
    await env.DB.prepare("INSERT INTO providers VALUES(?,?,?,?,?)")
      .bind(
        "groq-fast",
        "groq",
        "openai/gpt-oss-20b",
        1,
        await seal("fallback-test-key", env.VAULT_KEY, "groq-fast"),
      )
      .run();
    const broken = new Response(
      'data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n',
    );
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(broken);
    const response = await request(alice, "chat", "POST", {
      requestId: "partial",
      conversationId: "c",
      text: "Hi",
    });
    const text = await response.text();
    await Promise.all(pending);
    expect(text).toContain("Partial answer");
    expect(text).toContain("event: error");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await env.DB.prepare("SELECT status FROM requests WHERE id=?")
          .bind("partial")
          .first<{ status: string }>()
      )?.status,
    ).toBe("failed");
  });
  it("prevents simultaneous replies and finalizes cancellation", async () => {
    await ready();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) reject(new Error("aborted"));
          else
            signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
        }),
    );
    const first = await request(alice, "chat", "POST", {
      requestId: "running",
      conversationId: "c",
      text: "Hi",
    });
    await expect(
      request(alice, "chat", "POST", {
        requestId: "overlap",
        conversationId: "c",
        text: "Hello",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await first.body!.cancel();
    await Promise.all(pending);
    expect(
      (
        await env.DB.prepare("SELECT status FROM requests WHERE id=?")
          .bind("running")
          .first<{ status: string }>()
      )?.status,
    ).toBe("cancelled");
  });
});
