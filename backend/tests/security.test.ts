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
import { sseData, speech, chat, CLOUDFLARE_MODELS, cloudflareContext, safeProviderError } from "../src/providers";
import { challenge, completeBrowserLogin, browserLoginStatus, verifyGoogleCredential } from "../src/browserLogin";
import worker, { route, trustedRelease } from "../src/index";
import { DEFAULT_CONFIG, relevantMemories } from "../src/config";
import type { Env, Identity } from "../src/types";
import { ApiError } from "../src/types";
import { digest, replyProof, verifyReply } from "../src/replyProof";
import { usefulSummary } from "../src/contextStore";
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
    GOOGLE_WEB_CLIENT_ID: "test-google-client",
    VAULT_KEY: btoa("12345678901234567890123456789012"),
    RELEASE_REPOSITORY: "psychspy7/KITTY.AI-v2",
  };
  for (const sql of ["0001.sql", "0002_login_and_free_ai.sql", "0003_provider_checks_and_voices.sql", "0004_context_and_local_history.sql"].map(file => readFileSync(
    new URL(`../migrations/${file}`, import.meta.url),
    "utf8",
  )).join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await env.DB.prepare(sql).run();
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  env.HISTORY_MODE=undefined;
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
    "provider_checks",
    "settings",
    "announcements",
    "notice_reads",
    "audit",
    "browser_logins",
    "context_cache", "context_jobs", "context_tombstones", "shared_examples", "history_exports",
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
describe("1.7 local history, verified replies and bounded context",()=>{
  beforeEach(()=>{env.HISTORY_MODE="local";});
  it("does not store chat transcripts and replays an encrypted completion without a second charge",async()=>{
    await ready();
    const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(async (_url,options)=>{
      const input=JSON.parse(String(options?.body));
      return providerStream(input.max_tokens===512?JSON.stringify({facts:["Likes short answers"],goals:[],topic:"Planning"}):"Private complete answer");
    });
    const input={requestId:"local-one",conversationId:"local-chat",text:"Private question",context:[{role:"assistant",content:"Recent answer"}]};
    const output=await(await request(alice,"chat","POST",input)).text();
    await Promise.all(pending);
    expect(output).toContain("event: done");
    const done=JSON.parse(output.split("event: done\ndata: ")[1].split("\n")[0]);
    expect(await verifyReply(env,alice.uid,"local-one-a",done.questionHash,"Private complete answer",done.proof)).toBe(true);
    expect(await env.DB.prepare("SELECT * FROM messages WHERE uid=?").bind(alice.uid).all()).toMatchObject({results:[]});
    const row=await env.DB.prepare("SELECT text,response FROM requests WHERE uid=?").bind(alice.uid).first<{text:string;response:string}>();
    expect(row?.text).toBe(await digest("Private question"));
    expect(row?.response).not.toContain("Private complete answer");
    const calls=fetch.mock.calls.length;
    expect(await(await request(alice,"chat","POST",input)).text()).toContain("Private complete answer");
    expect(fetch).toHaveBeenCalledTimes(calls);
    await request(alice,"reply/ack","POST",{requestId:"local-one"});
    expect((await env.DB.prepare("SELECT response FROM requests WHERE uid=?").bind(alice.uid).first())?.response).toBe("");
    await expect(request(alice,"chat","POST",input)).rejects.toMatchObject({status:409});
  });
  it("binds receipts to the exact user, message, question and reply including Unicode",async()=>{
    const r=await replyProof(env,alice.uid,"m-a","你好","**Hello** 😺");
    expect(await verifyReply(env,alice.uid,"m-a",r.questionHash,"**Hello** 😺",r.proof)).toBe(true);
    expect(await verifyReply(env,bob.uid,"m-a",r.questionHash,"**Hello** 😺",r.proof)).toBe(false);
    expect(await verifyReply(env,alice.uid,"other",r.questionHash,"**Hello** 😺",r.proof)).toBe(false);
    expect(await verifyReply(env,alice.uid,"m-a",r.questionHash,"Altered",r.proof)).toBe(false);
  });
  it("exports only the verified account and purges legacy data only after a matching acknowledgment",async()=>{
    for(const user of [alice,bob]) {
      await env.DB.prepare("INSERT INTO conversations VALUES(?,?,?,?)").bind(user.uid,"old","Old chat",1).run();
      await env.DB.prepare("INSERT INTO messages VALUES(?,?,?,'user',?,?,'complete',?)").bind(user.uid,"q-u","old",`${user.uid} question`,1,"q").run();
      await env.DB.prepare("INSERT INTO messages VALUES(?,?,?,'assistant',?,?,'complete',?)").bind(user.uid,"q-a","old",`${user.uid} answer`,2,"q").run();
    }
    const page=await(await request(alice,"history/export")).json() as {token:string;messages:{text:string;proof?:string}[]};
    expect(page.messages).toHaveLength(2);
    expect(JSON.stringify(page)).not.toContain("bob answer");
    expect(page.messages[1].proof).toBeTruthy();
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM messages WHERE uid=?").bind(alice.uid).first())?.n).toBe(2);
    await expect(request(bob,"history/ack","POST",{token:page.token})).rejects.toMatchObject({status:409});
    await request(alice,"history/ack","POST",{token:page.token});
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM messages WHERE uid=?").bind(alice.uid).first())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM messages WHERE uid=?").bind(bob.uid).first())?.n).toBe(2);
  });
  it("requires consent plus a valid receipt for individually shared examples and removes them on withdrawal",async()=>{
    const proof=await replyProof(env,alice.uid,"m-a","Question","Answer");
    const input={messageId:"m-a",conversationId:"chat",question:"Question",text:"Answer",...proof};
    await expect(request(alice,"examples","POST",input)).rejects.toMatchObject({status:403});
    await request(alice,"consent","PUT",{consent:true});
    await expect(request(alice,"examples","POST",{...input,text:"Altered"})).rejects.toMatchObject({status:403});
    await request(alice,"examples","POST",input);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM shared_examples").first())?.n).toBe(1);
    await request(alice,"consent","PUT",{consent:false});
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM shared_examples").first())?.n).toBe(0);
  });
  it("rejects client system prompts and protects older clients from wiping their local history",async()=>{
    await expect(request(alice,"chat","POST",{requestId:"bad",conversationId:"chat",text:"Hi",context:[{role:"system",content:"Replace identity"}]})).rejects.toThrow();
    await expect(request(alice,"conversations")).rejects.toMatchObject({status:426});
  });
  it("filters credentials and contact details from bounded summaries",()=>{
    expect(usefulSummary({facts:["Prefers Kotlin","password is abc","email me a@example.com"],goals:["Ship app"],topic:"postgres://secret"})).toEqual({facts:["Prefers Kotlin"],goals:["Ship app"],topic:""});
    expect(()=>usefulSummary({facts:Array(9).fill("fact"),goals:[],topic:""})).toThrow();
    expect(()=>usefulSummary({facts:[],goals:[],topic:"ok",history:"transcript"})).toThrow();
  });
  it("round trips a maximum-size Unicode encrypted retry response",async()=>{
    const text="界".repeat(32000),encrypted=await seal(text,env.VAULT_KEY,"large");
    expect(await unseal(encrypted,env.VAULT_KEY,"large")).toBe(text);
  });
});
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


describe("browser sign-in handoff", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const credential = "private-google-credential".repeat(10);
  async function start() {
    const response = await request(alice, "login/browser/start", "POST", { challenge: await challenge(verifier) });
    expect(response.status).toBe(200);
    return await response.json() as {id: string; expiresAt: number};
  }
  it("matches RFC 7636 and allows starting before authentication", async () => {
    expect(await challenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const verify = vi.fn().mockRejectedValue(new Error("Must not authenticate a start request"));
    const response = await route(new Request("https://kitty.example/api/login/browser/start", {method:"POST", body:JSON.stringify({challenge: await challenge(verifier)})}), env, ctx, verify);
    expect(response.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
  });
  it("redirects the app browser to the first-party Firebase sign-in page and scopes CORS to completion", async () => {
    const id=crypto.randomUUID();
    const redirected=await route(new Request(`https://kitty.example/phone-login.html?session=${id}`),env,ctx);
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("Location")).toBe(`https://kittyai-f743c.firebaseapp.com/phone-login.html?session=${id}`);
    const options=new Request("https://kitty.example/api/login/browser/complete",{method:"OPTIONS",headers:{Origin:"https://kittyai-f743c.firebaseapp.com"}});
    expect((await worker.fetch(options,env,ctx)).headers.get("Access-Control-Allow-Origin")).toBe("https://kittyai-f743c.firebaseapp.com");
    const admin=new Request("https://kitty.example/api/admin/config",{headers:{Origin:"https://kittyai-f743c.firebaseapp.com"}});
    const forbidden=await worker.fetch(admin,env,ctx);
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.has("Access-Control-Allow-Origin")).toBe(false);
    const unsigned=new Request("https://kitty.example/api/login/browser/complete",{method:"POST",headers:{Origin:"https://kittyai-f743c.firebaseapp.com"},body:"{}"});
    const rejected=await worker.fetch(unsigned,env,ctx);
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("Access-Control-Allow-Origin")).toBe("https://kittyai-f743c.firebaseapp.com");
  });
  it("keeps credentials pending and rejects a stolen public link without its private proof", async () => {
    const {id} = await start();
    expect((await browserLoginStatus(env, {id, verifier})).status).toBe(202);
    await expect(browserLoginStatus(env, {id, verifier: "x".repeat(43)})).rejects.toMatchObject({status:404});
  });
  it("encrypts the Google credential, binds the verified UID, and consumes it only once", async () => {
    const {id} = await start();
    const verify = vi.fn().mockResolvedValue(undefined);
    await completeBrowserLogin(env, alice, {id, googleIdToken:credential}, verify);
    expect(verify).toHaveBeenCalledWith(credential, alice.email, "test-google-client");
    const row = await env.DB.prepare("SELECT encrypted_credential,uid FROM browser_logins WHERE id=?").bind(id).first<{encrypted_credential:string;uid:string}>();
    expect(row?.uid).toBe(alice.uid);
    expect(row?.encrypted_credential).not.toContain(credential);
    expect(await (await browserLoginStatus(env, {id, verifier})).json()).toEqual({googleIdToken:credential,uid:alice.uid});
    await expect(browserLoginStatus(env, {id, verifier})).rejects.toMatchObject({status:404});
  });
  it("rejects replayed browser approval and an invalid Google token", async () => {
    const {id} = await start();
    await expect(completeBrowserLogin(env, alice, {id, googleIdToken:credential}, async () => { throw new Error("Invalid Google signature"); })).rejects.toThrow("Invalid Google signature");
    await completeBrowserLogin(env, alice, {id, googleIdToken:credential}, async () => {});
    await expect(completeBrowserLogin(env, bob, {id, googleIdToken:credential}, async () => {})).rejects.toMatchObject({status:409});
  });
  it("expires and cancels unconsumed sign-ins", async () => {
    const {id} = await start();
    await env.DB.prepare("UPDATE browser_logins SET expires_at=0 WHERE id=?").bind(id).run();
    await expect(browserLoginStatus(env, {id, verifier})).rejects.toMatchObject({status:404});
    const next = await start();
    expect((await browserLoginStatus(env, {id:next.id, verifier}, true)).status).toBe(200);
    await expect(completeBrowserLogin(env, alice, {id:next.id,googleIdToken:credential}, async () => {})).rejects.toMatchObject({status:409});
  });
  it("lets at most one simultaneous poll consume the credential", async () => {
    const {id} = await start();
    await completeBrowserLogin(env, alice, {id, googleIdToken:credential}, async () => {});
    const attempts = await Promise.allSettled([browserLoginStatus(env,{id,verifier}),browserLoginStatus(env,{id,verifier})]);
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("rejects foreign origins and limits anonymous starts", async () => {
    await expect(route(new Request("https://kitty.example/api/login/browser/start", {method:"POST", headers:{Origin:"https://evil.example"},body:"{}"}),env,ctx)).rejects.toMatchObject({status:403});
    for (let i=0;i<30;i++) await start();
    await expect(start()).rejects.toMatchObject({status:429});
  });
  it("requires the expected Google audience, signature and matching verified email", async () => {
    const {privateKey,publicKey}=await generateKeyPair("RS256");
    const jwk=await exportJWK(publicKey); jwk.kid="google-test";
    const keys=createLocalJWKSet({keys:[jwk]});
    const token=await new SignJWT({email:alice.email,email_verified:true}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer("https://accounts.google.com").setAudience("test-google-client").setSubject("google-alice").setIssuedAt().setExpirationTime("5m").sign(privateKey);
    await expect(verifyGoogleCredential(token,alice.email,"test-google-client",keys)).resolves.toBeUndefined();
    await expect(verifyGoogleCredential(token,bob.email,"test-google-client",keys)).rejects.toMatchObject({status:401});
    await expect(verifyGoogleCredential(token,alice.email,"wrong-client",keys)).rejects.toMatchObject({status:401});
  });
});

describe("Cloudflare free chat", () => {
  const p = {id:"cloudflare-free",kind:"cloudflare" as const,model:CLOUDFLARE_MODELS[0],enabled:1,encrypted_key:""};
  it("bounds Unicode context while preserving core instructions and the latest question", () => {
    const messages = [{role:"system" as const,content:"Core identity"},{role:"user" as const,content:"猫".repeat(8000)},{role:"assistant" as const,content:"Older answer"},{role:"user" as const,content:"Latest question"}];
    expect(cloudflareContext(messages)).toEqual([messages[0],messages[3]]);
    expect(() => cloudflareContext([{role:"system",content:"Core identity"},{role:"user",content:"猫".repeat(8000)}])).toThrow("too long");
  });
  it("blocks selecting a speech model for the Groq chat endpoint", async () => {
    await expect(request(owner,"admin/providers","PUT",{id:"groq-main",kind:"groq",model:"canopylabs/orpheus-v1-english",enabled:true,key:"test-provider-key"})).rejects.toMatchObject({status:400});
  });
  it("streams without a provider key and forwards cancellation", async () => {
    const signal=new AbortController().signal;
    const run=vi.fn().mockResolvedValue(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"response":"Hello Sir."}\n\ndata: [DONE]\n\n'));c.close();}}));
    const parts=[];
    for await(const part of chat(p,{...env,VAULT_KEY:undefined,AI:{run} as unknown as Ai},[{role:"user",content:"Hi"}],128,signal))parts.push(part);
    expect(parts.join("")).toBe("Hello Sir.");
    expect(run).toHaveBeenCalledWith(p.model,expect.objectContaining({stream:true,max_tokens:128}),{signal});
  });
  it("fails clearly on missing binding, unknown models, exhausted allowance and cancellation", async () => {
    const consume=async (e:Env,model=p.model,signal=new AbortController().signal) => { for await(const _ of chat({...p,model},e,[{role:"user",content:"Hi"}],128,signal)){} };
    await expect(consume({...env,AI:undefined})).rejects.toMatchObject({status:503});
    const run=vi.fn().mockRejectedValue(new Error("Free limit"));
    const ai={...env,AI:{run} as unknown as Ai};
    await expect(consume(ai,"unsupported" as typeof p.model)).rejects.toMatchObject({status:400});
    await expect(consume(ai)).rejects.toMatchObject({status:503});
    await expect(consume(ai,p.model,AbortSignal.abort())).rejects.toMatchObject({name:"AbortError"});
  });
});

it("pins first-party APK updates as well as the owner repository",()=>{expect(trustedRelease("https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.0.3.apk",env.RELEASE_REPOSITORY)).toBe(true);expect(trustedRelease("https://evil.kitty-ai.workers.dev/downloads/KITTY-AI-1.0.3.apk",env.RELEASE_REPOSITORY)).toBe(false);expect(trustedRelease("https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.0.3.apk?x=1",env.RELEASE_REPOSITORY)).toBe(false);});

describe("v1.5 provider checks and speech", () => {
  it("loads Cloudflare speech settings without blocking chat or the owner console", async () => {
    await ready();
    await env.DB.prepare("UPDATE settings SET data=? WHERE id=1")
      .bind(JSON.stringify({...enabled,speechProvider:"cloudflare-free",speechModel:"@cf/myshell-ai/melotts",speechVoice:"en"})).run();
    expect((await (await request(owner,"admin/config")).json() as any).speechModel).toBe("@cf/myshell-ai/melotts");
    vi.spyOn(globalThis,"fetch").mockResolvedValue(providerStream());
    expect(await (await request(owner,"admin/chat-test","POST",{})).json()).toMatchObject({ok:true});
  });
  it("requires the exact owner for provider and route tests", async () => {
    await expect(request(alice,"admin/providers/test","POST",{id:"groq-main",kind:"groq",model:"test",mode:"chat"})).rejects.toMatchObject({status:403});
    await expect(request(alice,"admin/chat-test","POST",{})).rejects.toMatchObject({status:403});
  });
  it("tests a new key before saving and keeps a working key on failure", async () => {
    await ready();
    const old=await env.DB.prepare("SELECT encrypted_key FROM providers WHERE id='groq-main'").first();
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("private upstream secret",{status:401}));
    const result=await (await request(owner,"admin/providers/test","POST",{id:"groq-main",kind:"groq",model:"openai/gpt-oss-120b",mode:"chat",key:"rejected-test-key",save:true})).json() as any;
    expect(result.ok).toBe(false);
    expect(result.saved).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private upstream secret");
    expect(JSON.stringify(result)).not.toContain("rejected-test-key");
    expect(await env.DB.prepare("SELECT encrypted_key FROM providers WHERE id='groq-main'").first()).toEqual(old);
  });
  it("saves a successful test encrypted and exposes only test metadata", async () => {
    await ready();
    vi.spyOn(globalThis,"fetch").mockResolvedValue(providerStream());
    const result=await (await request(owner,"admin/providers/test","POST",{id:"groq-main",kind:"groq",model:"openai/gpt-oss-120b",mode:"chat",key:"replacement-key",save:true})).json() as any;
    expect(result).toMatchObject({ok:true,saved:true,preview:"Hi Sir."});
    const saved=await env.DB.prepare("SELECT encrypted_key FROM providers WHERE id='groq-main'").first<{encrypted_key:string}>();
    expect(saved?.encrypted_key).not.toContain("replacement-key");
    expect(await unseal(saved!.encrypted_key,env.VAULT_KEY,"groq-main")).toBe("replacement-key");
    const listed=await (await request(owner,"admin/providers")).text();
    expect(listed).toContain("tested_at");
    expect(listed).not.toContain("replacement-key");
    expect(listed).not.toContain("encrypted_key");
  });
  it("the real chat-route probe completes and removes its synthetic history", async () => {
    await ready();
    vi.spyOn(globalThis,"fetch").mockResolvedValue(providerStream());
    const result=await (await request(owner,"admin/chat-test","POST",{})).json() as any;
    expect(result).toMatchObject({ok:true,preview:"Hi Sir."});
    for(const table of ["messages","requests","conversations","profiles"])
      expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM "+table).first<{n:number}>())!.n).toBe(0);
  });
  it("reports rate limits safely and stores a failed live-provider check", async () => {
    await ready();
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("secret",{status:429}));
    const reply=await request(alice,"chat","POST",{requestId:"rate-test",conversationId:"rate-chat",text:"hello"});
    expect(await reply.text()).toContain("Groq rate limit");
    await Promise.all(pending);
    const check=await env.DB.prepare("SELECT * FROM provider_checks WHERE mode='live_chat'").first<any>();
    expect(check?.ok).toBe(0);
    expect(check?.error).not.toContain("secret");
  });
  it("preserves multiline SSE JSON and UTF-8 boundaries", async () => {
    const bytes=new TextEncoder().encode('data: {\n: comment\ndata: "text":"猫"}\n\n');
    const stream=new ReadableStream<Uint8Array>({start(c){ for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close(); }});
    const frames=[];for await(const value of sseData(stream))frames.push(value);
    expect(frames).toEqual(['{\n"text":"猫"}']);
  });
  it("rejects a completed reasoning-only reply instead of claiming success", async () => {
    const p={id:"groq-main",kind:"groq" as const,model:"openai/gpt-oss-120b",enabled:1,encrypted_key:await seal("test-provider-key",env.VAULT_KEY,"groq-main")};
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response('data: {"choices":[{"delta":{"reasoning":"thinking"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'));
    await expect((async()=>{for await(const _ of chat(p,env,[{role:"user",content:"hi"}],1024,new AbortController().signal)){} })()).rejects.toThrow("no visible answer");
  });
  it.each(["elevenlabs","fish"] as const)("uses the official %s speech contract and MP3 response", async kind => {
    const id=kind+"-test";
    const p={id,kind,model:kind==="fish"?"s2.1-pro-free":"eleven_multilingual_v2",enabled:1,encrypted_key:await seal("test-speech-key",env.VAULT_KEY,id)};
    const mock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(Uint8Array.of(73,68,51,4,0,0,0,0,0,0)));
    expect((await speech(p,env,"Hello Sir",p.model,"voice123",new AbortController().signal)).mimeType).toBe("audio/mpeg");
    const [url,init]=mock.mock.calls[0];
    const headers=init!.headers as Record<string,string>,body=JSON.parse(init!.body as string);
    expect(body.text).toBe("Hello Sir");
    if(kind==="fish") {
      expect(url).toBe("https://api.fish.audio/v1/tts");
      expect(headers.model).toBe("s2.1-pro-free");
      expect(headers.Authorization).toBe("Bearer test-speech-key");
      expect(body.reference_id).toBe("voice123");
    } else {
      expect(String(url)).toContain("/text-to-speech/voice123");
      expect(headers["xi-api-key"]).toBe("test-speech-key");
      expect(body.model_id).toBe("eleven_multilingual_v2");
    }
  });
  it("rejects unknown Fish model spellings before a request can default to paid inference", async () => {
    const p={id:"fish-test",kind:"fish" as const,model:"s2.1-pro-free",enabled:1,encrypted_key:await seal("test-speech-key",env.VAULT_KEY,"fish-test")};
    const mock=vi.spyOn(globalThis,"fetch");
    await expect(speech(p,env,"Hi","s2.1-pro-fre","voice",new AbortController().signal)).rejects.toThrow("exact supported Fish model");
    expect(mock).not.toHaveBeenCalled();
  });
  it("never displays an arbitrary upstream exception message", () => {
    expect(safeProviderError(new Error("super-secret-key"),"groq").message).not.toContain("super-secret-key");
    expect(safeProviderError(new ApiError(429,"Safe rate limit"),"groq").message).toBe("Safe rate limit");
  });
});
