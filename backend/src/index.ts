import { z } from "zod";
import { authenticate, isOwner } from "./auth";
import { configSchema, getConfig, relevantMemories } from "./config";
import { seal, unseal } from "./vault";
import { chat, speech, CLOUDFLARE_MODELS, CLOUDFLARE_SPEECH, FISH_MODELS, isGroqChatModel, safeProviderError } from "./providers";
import {providerInputSchema,candidateProvider,providerWrite,testProvider} from "./providerAdmin";
import { startBrowserLogin, browserLoginStatus, completeBrowserLogin } from "./browserLogin";
import {
  ApiError,
  type Env,
  type Identity,
  type Provider,
  type Message,
} from "./types";

const idSchema = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
const PHONE_AUTH_ORIGIN = "https://kittyai-f743c.firebaseapp.com";
function browserCors(request: Request): Record<string,string> {
  return request.headers.get("Origin") === PHONE_AUTH_ORIGIN && new URL(request.url).pathname === "/api/login/browser/complete"
    ? {"Access-Control-Allow-Origin":PHONE_AUTH_ORIGIN,"Access-Control-Allow-Methods":"POST","Access-Control-Allow-Headers":"Authorization, Content-Type","Vary":"Origin"}
    : {};
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request): Promise<unknown> {
  if (Number(request.headers.get("Content-Length") || 0) > 32768)
    throw new ApiError(413, "Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Missing request.");
  let data = "",
    size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) throw new ApiError(413, "Request too large.");
      data += decoder.decode(value, { stream: true });
    }
    data += decoder.decode();
    return JSON.parse(data);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Invalid JSON.");
  } finally {
    await reader.cancel().catch(() => {});
  }
}
async function audit(env: Env, user: Identity, action: string) {
  await env.DB.prepare("INSERT INTO audit VALUES(?,?,?,?)")
    .bind(crypto.randomUUID(), user.uid, action, Date.now())
    .run();
}
async function quota(env: Env, uid: string, kind: string, limit: number) {
  if (limit <= 0)
    throw new ApiError(429, "Daily limit reached. Try again tomorrow.");
  const result = await env.DB.prepare(
    "INSERT INTO usage(uid,day,kind,count) VALUES(?,?,?,1) ON CONFLICT(uid,day,kind) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count",
  )
    .bind(uid, new Date().toISOString().slice(0, 10), kind, limit)
    .first();
  if (!result)
    throw new ApiError(429, "Daily limit reached. Try again tomorrow (UTC).");
}
async function provider(env: Env, id: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM providers WHERE id=? AND enabled=1",
  )
    .bind(id)
    .first<Provider>();
  if (!row) throw new ApiError(503, "No configured provider is available.");
  return row;
}
async function streamChat(
  request: Request,
  env: Env,
  user: Identity,
  ctx: ExecutionContext,
) {
  const input = z
    .object({
      requestId: idSchema,
      conversationId: idSchema,
      text: z.string().trim().min(1).max(8000),
    })
    .strict()
    .parse(await body(request));
  const existing = await env.DB.prepare(
    "SELECT * FROM requests WHERE uid=? AND id=?",
  )
    .bind(user.uid, input.requestId)
    .first<{
      status: string;
      response: string;
      text: string;
      conversation_id: string;
      updated_at: number;
    }>();
  if (
    existing &&
    (existing.text !== input.text ||
      existing.conversation_id !== input.conversationId)
  )
    throw new ApiError(409, "Request ID belongs to a different message.");
  const event = (type: string, data: unknown) =>
    new TextEncoder().encode(
      `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  if (existing?.status === "complete")
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(event("delta", { text: existing.response }));
          c.enqueue(event("done", { requestId: input.requestId }));
          c.close();
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
        },
      },
    );
  const config = await getConfig(env);
  if (!config.enabled)
    throw new ApiError(
      503,
      "KITTY is taking a short break. Please check the Inbox.",
    );
  // Expired locks survive a disconnected Worker; normal requests have a 90-second upstream deadline.
  await env.DB.prepare(
    "UPDATE requests SET status='failed' WHERE uid=? AND status='running' AND updated_at < ?",
  )
    .bind(user.uid, Date.now() - 180000)
    .run();
  try {
    const claim = existing
      ? await env.DB.prepare(
          "UPDATE requests SET status='running',response='',updated_at=? WHERE uid=? AND id=? AND status IN ('failed','cancelled') RETURNING id",
        )
          .bind(Date.now(), user.uid, input.requestId)
          .first()
      : await env.DB.prepare(
          "INSERT INTO requests(uid,id,conversation_id,text,status,updated_at) VALUES(?,?,?,?,'running',?) RETURNING id",
        )
          .bind(
            user.uid,
            input.requestId,
            input.conversationId,
            input.text,
            Date.now(),
          )
          .first();
    if (!claim)
      throw new ApiError(
        409,
        "This reply is still running. Wait or stop it first.",
      );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(409, "A reply is already running for this account.");
  }
  try {
    const profile = await env.DB.prepare(
      "SELECT disabled,daily_limit FROM profiles WHERE uid=?",
    )
      .bind(user.uid)
      .first<{ disabled: number; daily_limit: number | null }>();
    if (profile?.disabled)
      throw new ApiError(403, "This account has been paused by the owner.");
    await quota(
      env,
      user.uid,
      "chat",
      profile?.daily_limit ?? config.dailyChatLimit,
    );
    await quota(env, "__global__", "chat", config.globalDailyChatLimit);
    const available: Provider[] = [];
    for (const id of config.chatProviders) {
      try {
        available.push(await provider(env, id));
      } catch {}
    }
    if (!available.length)
      throw new ApiError(503, "The owner needs to configure a chat provider.");
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM conversations WHERE uid=?",
    )
      .bind(user.uid)
      .first<{ n: number }>();
    const conversation = await env.DB.prepare(
      "SELECT id FROM conversations WHERE uid=? AND id=?",
    )
      .bind(user.uid, input.conversationId)
      .first();
    if (!conversation && (count?.n || 0) >= 200)
      throw new ApiError(
        400,
        "Conversation limit reached. Delete an old conversation.",
      );
    const messageCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM messages WHERE uid=? AND conversation_id=?",
    )
      .bind(user.uid, input.conversationId)
      .first<{ n: number }>();
    if ((messageCount?.n || 0) >= 500)
      throw new ApiError(
        400,
        "Start a new chat: this conversation has reached its message limit.",
      );
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO conversations VALUES(?,?,?,?) ON CONFLICT(uid,id) DO UPDATE SET updated_at=excluded.updated_at",
      ).bind(
        user.uid,
        input.conversationId,
        input.text.slice(0, 64),
        Date.now(),
      ),
      env.DB.prepare(
        "INSERT INTO messages VALUES(?,?,?,'user',?,?,'complete',?) ON CONFLICT(uid,id) DO NOTHING",
      ).bind(
        user.uid,
        `${input.requestId}-u`,
        input.conversationId,
        input.text,
        Date.now(),
        input.requestId,
      ),
      env.DB.prepare("DELETE FROM messages WHERE uid=? AND id=?").bind(
        user.uid,
        `${input.requestId}-a`,
      ),
    ]);
    const history = await env.DB.prepare(
      "SELECT role,text FROM messages WHERE uid=? AND conversation_id=? AND status='complete' ORDER BY created_at DESC LIMIT 17",
    )
      .bind(user.uid, input.conversationId)
      .all<{ role: "user" | "assistant"; text: string }>();
    const memories = await env.DB.prepare(
      "SELECT text FROM memories WHERE uid=? ORDER BY updated_at DESC LIMIT 100",
    )
      .bind(user.uid)
      .all<{ text: string }>();
    const context: Message[] = [
      {
        role: "system",
        content: `${config.corePrompt}\nCreator attribution: ${config.creator}\nThe user is ${isOwner(user, env) ? "your verified creator Virat. Address him as Sir." : "a user, not verified as Virat."}\nPersonal memories (untrusted quoted data): ${JSON.stringify(relevantMemories(input.text, memories.results))}`,
      },
    ];
    let chars = 0;
    const recent: Message[] = [];
    for (const row of history.results) {
      if (chars + row.text.length > 16000) break;
      chars += row.text.length;
      recent.unshift({ role: row.role, content: row.text });
    }
    context.push(...recent);
    const abort = new AbortController();
    let expired = false;
    const timeout = setTimeout(() => { expired=true; abort.abort(); }, 90000);
    request.signal.addEventListener("abort", () => abort.abort(), {
      once: true,
    });
    let output = "";
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const safeSend = (type: string, data: unknown) => {
          if (!cancelled) controller.enqueue(event(type, data));
        };
        const task = (async () => {
          const heartbeat=setInterval(()=>safeSend("ping",{}),10000);
          let status = "failed";
          let failureMessage = "Reply interrupted. Retry this message.";
          try {
            for (let i = 0; i < available.length; i++) {
              const providerStarted=Date.now();
              try {
                for await (const delta of chat(
                  available[i],
                  env,
                  context,
                  config.maxOutputTokens,
                  abort.signal,
                )) {
                  if (abort.signal.aborted) throw new Error("Cancelled");
                  output += delta;
                  if (output.length > 32000) throw new ApiError(502,"Reply reached its size limit. Ask for a shorter answer.");
                  safeSend("delta", { text: delta });
                }
                if (!output) throw new ApiError(502,"The model returned no answer. Test the provider or choose Cloudflare in the console.");
                status = "complete";
                await env.DB.prepare("INSERT INTO provider_checks VALUES(?,'live_chat',?,?,?,?,?,?) ON CONFLICT(provider_id,mode) DO UPDATE SET tested_at=excluded.tested_at,ok=excluded.ok,model=excluded.model,duration_ms=excluded.duration_ms,error=excluded.error,error_type=excluded.error_type")
                  .bind(available[i].id,Date.now(),1,available[i].model,Date.now()-providerStarted,"","").run().catch(()=>{});
                break;
              } catch (error) {
                // Only names and provider metadata enter diagnostics, never keys/prompts/tokens.
                const safe=safeProviderError(error,available[i].kind);
                await env.DB.prepare("INSERT INTO provider_checks VALUES(?,'live_chat',?,?,?,?,?,?) ON CONFLICT(provider_id,mode) DO UPDATE SET tested_at=excluded.tested_at,ok=excluded.ok,model=excluded.model,duration_ms=excluded.duration_ms,error=excluded.error,error_type=excluded.error_type")
                  .bind(available[i].id,Date.now(),0,available[i].model,Date.now()-providerStarted,safe.message,error instanceof Error?error.name:"Unknown").run().catch(()=>{});
                if (
                  output ||
                  abort.signal.aborted ||
                  i === available.length - 1
                )
                  throw safe;
              }
            }
          } catch (error) {
            status = abort.signal.aborted && !expired ? "cancelled" : "failed";
            if (error instanceof ApiError) failureMessage = error.message;
            if(expired)failureMessage="The AI request timed out. Retry or choose another provider in the console.";
          } finally {
            clearInterval(heartbeat);
            clearTimeout(timeout);
            await env.DB.batch([
              env.DB.prepare(
                "INSERT INTO messages VALUES(?,?,?,'assistant',?,?,?,?) ON CONFLICT(uid,id) DO UPDATE SET text=excluded.text,status=excluded.status",
              ).bind(
                user.uid,
                `${input.requestId}-a`,
                input.conversationId,
                output,
                Date.now(),
                status,
                input.requestId,
              ),
              env.DB.prepare(
                "UPDATE requests SET status=?,response=?,updated_at=? WHERE uid=? AND id=?",
              ).bind(status, output, Date.now(), user.uid, input.requestId),
            ]);
            safeSend(
              status === "complete" ? "done" : "error",
              status === "complete"
                ? { requestId: input.requestId }
                : {
                    message:
                      status === "cancelled"
                        ? "Reply stopped."
                        : failureMessage,
                  },
            );
            if (!cancelled) controller.close();
          }
        })().catch(() => {
          if (!cancelled) {
            safeSend("error", {
              message:
                "Unable to save this reply. Refresh history before retrying.",
            });
            controller.close();
          }
        });
        ctx.waitUntil(task);
      },
      cancel() {
        cancelled = true;
        abort.abort();
        clearTimeout(timeout);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    await env.DB.prepare(
      "UPDATE requests SET status='failed',updated_at=? WHERE uid=? AND id=?",
    )
      .bind(Date.now(), user.uid, input.requestId)
      .run();
    throw error;
  }
}

export async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  verify = authenticate,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (path === "/phone-login" || path === "/phone-login.html") {
    const destination = new URL("/phone-login.html", PHONE_AUTH_ORIGIN);
    const session = url.searchParams.get("session");
    if (session && /^[a-f0-9-]{36}$/.test(session)) destination.searchParams.set("session",session);
    return Response.redirect(destination.toString(),302);
  }
  if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (path === "/api/health")
    return json({ service: "KITTY", version: "1.5.0" });
  const origin = request.headers.get("Origin");
  const phoneAuth = path === "/api/login/browser/complete" && origin === PHONE_AUTH_ORIGIN;
  if (origin && origin !== url.origin && !phoneAuth)
    throw new ApiError(403, "Use the console on the backend domain.");
  if (phoneAuth && method === "OPTIONS") return new Response(null,{status:204,headers:browserCors(request)});
  if (path === "/api/login/browser/start" && method === "POST")
    return startBrowserLogin(request, env, await body(request));
  if (path === "/api/login/browser/poll" && method === "POST")
    return browserLoginStatus(env, await body(request));
  if (path === "/api/login/browser/cancel" && method === "POST")
    return browserLoginStatus(env, await body(request), true);
  const user = await verify(request, env);
  const profile = await env.DB.prepare(
    "SELECT disabled FROM profiles WHERE uid=?",
  )
    .bind(user.uid)
    .first<{ disabled: number }>();
  if (profile?.disabled && !isOwner(user, env))
    throw new ApiError(403, "Account paused.");
  if (path === "/api/login/browser/complete" && method === "POST")
    return completeBrowserLogin(env, user, await body(request));
  if (path === "/api/me" && method === "GET")
    return json({
      uid: user.uid,
      email: user.email,
      admin: isOwner(user, env),
      activationPending: !env.OWNER_UID && user.email === env.OWNER_EMAIL,
    });
  if (path.startsWith("/api/admin/")) {
    if (!isOwner(user, env)) throw new ApiError(403, "Owner access required.");
    if (path === "/api/admin/config" && method === "GET")
      return json(await getConfig(env));
    if (path === "/api/admin/config" && method === "PUT") {
      const config = configSchema.parse(await body(request));
      if (config.release.url && !config.release.sha256)
        throw new ApiError(400, "Publish the APK SHA-256 checksum with its update URL.");
      if (
        config.release.url &&
        !trustedRelease(config.release.url, env.RELEASE_REPOSITORY)
      )
        throw new ApiError(
          400,
          "Update URL must be an APK from the trusted KITTY download site or configured GitHub repository.",
        );
      await env.DB.prepare(
        "INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
        .bind(JSON.stringify(config))
        .run();
      await audit(env, user, "config.update");
      return json({ saved: true });
    }
    if (path === "/api/admin/providers" && method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id,kind,model,enabled FROM providers",
      ).all();
      const checks=await env.DB.prepare("SELECT * FROM provider_checks").all();
      return json(rows.results.map((r) => ({ ...r, keyConfigured: r.kind !== "cloudflare",checks:checks.results.filter(c=>c.provider_id===r.id) })));
    }
    if(path === "/api/admin/providers/test" && method === "POST") {
      await quota(env,user.uid,"provider-test",40);
      const result=await testProvider(env,await body(request));
      await audit(env,user,`provider.test:${result.provider}:${result.ok?"pass":"fail"}`);
      return json(result);
    }
    if(path === "/api/admin/chat-test" && method === "POST") {
      await quota(env,user.uid,"provider-test",40);
      const probeUid=`__kitty_probe__${crypto.randomUUID()}`;
      const probeUser={...user,uid:probeUid};
      const jobs:Promise<unknown>[]=[];
      const probeContext={waitUntil:(p:Promise<unknown>)=>{jobs.push(p);ctx.waitUntil(p);},passThroughOnException(){}} as ExecutionContext;
      const started=Date.now();
      try {
        const response=await streamChat(new Request(`${url.origin}/api/chat`,{method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.any([request.signal,AbortSignal.timeout(60000)]),body:JSON.stringify({requestId:crypto.randomUUID(),conversationId:crypto.randomUUID(),text:"Say hello KITTY in one short sentence."})}),{...env,OWNER_UID:probeUid},probeUser,probeContext);
        const text=await response.text();
        await Promise.allSettled(jobs);
        let preview="",error="";
        for(const frame of text.split(/\r?\n\r?\n/)) {
          const kind=frame.match(/^event: (\w+)/)?.[1],payload=frame.match(/\ndata: (.+)/)?.[1];
          if(!payload)continue;
          const data=JSON.parse(payload);
          if(kind==="delta")preview+=data.text||"";
          if(kind==="error")error=data.message||"Test failed.";
        }
        const ok=text.includes("event: done")&&!error&&!!preview;
        return json({ok,durationMs:Date.now()-started,preview:preview.slice(0,320),...(ok?{}:{error:error||"The route returned no complete reply."})});
      } finally {
        await Promise.allSettled(jobs);
        await env.DB.batch(["messages","requests","conversations","usage","profiles"].map(t=>env.DB.prepare(`DELETE FROM ${t} WHERE uid=?`).bind(probeUid)));
      }
    }
    if (path === "/api/admin/providers" && method === "PUT") {
      /* Provider writes use the same validation as pre-save testing. */
      const input = providerInputSchema.parse(await body(request));
      const p=await candidateProvider(env,input);
      await env.DB.batch([providerWrite(env,p),env.DB.prepare("DELETE FROM provider_checks WHERE provider_id=?").bind(p.id)]);
      await audit(env,user,`provider.update:${p.id}`);
      return json({saved:true});

    }
    const providerPath = path.match(/^\/api\/admin\/providers\/([a-z0-9-]+)$/);
    if (providerPath && method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM providers WHERE id=?").bind(providerPath[1]),
        env.DB.prepare("DELETE FROM provider_checks WHERE provider_id=?").bind(providerPath[1]),
      ]);
      await audit(env, user, `provider.delete:${providerPath[1]}`);
      return json({ deleted: true });
    }
    if (path === "/api/admin/models" && method === "GET") {
      const p = await provider(env, url.searchParams.get("provider") || "");
      if (p.kind === "cloudflare") return json([...CLOUDFLARE_MODELS,CLOUDFLARE_SPEECH]);
      if (p.kind === "fish") return json(FISH_MODELS);
      const key = await unseal(p.encrypted_key, env.VAULT_KEY, p.id);
      const response = await fetch(
        p.kind === "elevenlabs" ? "https://api.elevenlabs.io/v1/models" : p.kind === "groq"
          ? "https://api.groq.com/openai/v1/models"
          : "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
        {
          headers:
            p.kind === "elevenlabs" ? {"xi-api-key":key} : p.kind === "groq"
              ? { Authorization: `Bearer ${key}` }
              : { "x-goog-api-key": key },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        throw new ApiError(
          502,
          "Could not fetch models. Verify the key and provider account.",
        );
      const data = (await response.json()) as {
        data?: { id: string }[];
        models?: { name: string; supportedGenerationMethods?: string[] }[];
      };
      if(p.kind === "elevenlabs")return json((data as unknown as {model_id:string;can_do_text_to_speech:boolean}[]).filter(m=>m.can_do_text_to_speech).map(m=>m.model_id));
      return json(
        p.kind === "groq"
          ? (data.data || []).map((m) => m.id).filter(isGroqChatModel)
          : (data.models || []).map((m) => m.name.replace("models/", "")),
      );
    }
    if (path === "/api/admin/announcements" && method === "POST") {
      const input = z
        .object({
          title: z.string().trim().min(1).max(140),
          body: z.string().trim().min(1).max(4000),
        })
        .strict()
        .parse(await body(request));
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO announcements VALUES(?,?,?,?)")
        .bind(id, input.title, input.body, Date.now())
        .run();
      await audit(env, user, `announcement.publish:${id}`);
      return json({ id });
    }
    const noticePath = path.match(
      /^\/api\/admin\/announcements\/([a-zA-Z0-9-]+)$/,
    );
    if (noticePath && method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM announcements WHERE id=?").bind(
          noticePath[1],
        ),
        env.DB.prepare("DELETE FROM notice_reads WHERE id=?").bind(
          noticePath[1],
        ),
      ]);
      return json({ deleted: true });
    }
    if (path === "/api/admin/users" && method === "PUT") {
      const input = z
        .object({
          uid: z.string().min(1).max(128),
          disabled: z.boolean(),
          dailyLimit: z.number().int().min(1).max(1000).nullable(),
        })
        .strict()
        .parse(await body(request));
      if (input.uid === env.OWNER_UID && input.disabled)
        throw new ApiError(400, "Cannot pause the owner.");
      await env.DB.prepare(
        "INSERT INTO profiles(uid,disabled,daily_limit) VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET disabled=excluded.disabled,daily_limit=excluded.daily_limit",
      )
        .bind(input.uid, input.disabled ? 1 : 0, input.dailyLimit)
        .run();
      await audit(env, user, `user.update:${input.uid}`);
      return json({ saved: true });
    }
    if (path === "/api/admin/examples" && method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT e.message_id,e.created_at,m.text AS answer,(SELECT u.text FROM messages u WHERE u.uid=m.uid AND u.request_id=m.request_id AND u.role='user') AS question FROM examples e JOIN profiles p ON p.uid=e.uid AND p.consent=1 JOIN messages m ON m.uid=e.uid AND m.id=e.message_id WHERE m.status='complete' ORDER BY e.created_at DESC LIMIT 100",
      ).all();
      return json(rows.results);
    }
    if (path === "/api/admin/audit" && method === "GET")
      return json(
        (
          await env.DB.prepare(
            "SELECT action,created_at FROM audit ORDER BY created_at DESC LIMIT 100",
          ).all()
        ).results,
      );
  }
  if (path === "/api/config" && method === "GET") {
    const c = await getConfig(env);
    return json({
      enabled: c.enabled,
      creator: c.creator,
      dailyChatLimit: c.dailyChatLimit,
      speechEnabled: !!c.speechProvider,
      dailySpeechLimit: c.dailySpeechLimit,
    });
  }
  if (path === "/api/chat" && method === "POST")
    return streamChat(request, env, user, ctx);
  if (path === "/api/speech" && method === "POST") {
    const c = await getConfig(env);
    if (!c.enabled) throw new ApiError(503, "Service paused.");
    const input = z
      .object({ messageId: idSchema })
      .strict()
      .parse(await body(request));
    const message = await env.DB.prepare(
      "SELECT text FROM messages WHERE uid=? AND id=? AND role='assistant' AND status='complete'",
    )
      .bind(user.uid, input.messageId)
      .first<{ text: string }>();
    if (!message) throw new ApiError(404, "Finished reply not found.");
    if (message.text.length > 4000)
      throw new ApiError(
        400,
        "This reply is too long for speech. Ask for a shorter answer.",
      );
    await quota(env, user.uid, "speech", c.dailySpeechLimit);
    const p = await provider(env, c.speechProvider);
    return json(
      await speech(
        p,
        env,
        message.text,
        c.speechModel,
        c.speechVoice,
        AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
      ),
    );
  }
  if (path === "/api/conversations" && method === "GET")
    return json(
      (
        await env.DB.prepare(
          "SELECT * FROM conversations WHERE uid=? ORDER BY updated_at DESC LIMIT 200",
        )
          .bind(user.uid)
          .all()
      ).results,
    );
  const conversationPath = path.match(
    /^\/api\/conversations\/([a-zA-Z0-9-]+)$/,
  );
  if (conversationPath && method === "GET")
    return json(
      (
        await env.DB.prepare(
          "SELECT id,conversation_id,role,text,created_at,status,request_id FROM messages WHERE uid=? AND conversation_id=? ORDER BY created_at ASC LIMIT 500",
        )
          .bind(user.uid, conversationPath[1])
          .all()
      ).results,
    );
  if (conversationPath && method === "DELETE") {
    const running = await env.DB.prepare(
      "SELECT id FROM requests WHERE uid=? AND conversation_id=? AND status='running' AND updated_at>? LIMIT 1",
    )
      .bind(user.uid, conversationPath[1], Date.now() - 180000)
      .first();
    if (running)
      throw new ApiError(
        409,
        "Stop the reply and wait before deleting this conversation.",
      );
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM requests WHERE uid=? AND conversation_id=?",
      ).bind(user.uid, conversationPath[1]),
      env.DB.prepare("DELETE FROM conversations WHERE uid=? AND id=?").bind(
        user.uid,
        conversationPath[1],
      ),
    ]);
    return json({ deleted: true });
  }
  if (path === "/api/memories" && method === "GET")
    return json(
      (
        await env.DB.prepare(
          "SELECT id,text,updated_at FROM memories WHERE uid=? ORDER BY updated_at DESC",
        )
          .bind(user.uid)
          .all()
      ).results,
    );
  if (path === "/api/memories" && method === "PUT") {
    const input = z
      .object({ id: idSchema, text: z.string().trim().min(1).max(500) })
      .strict()
      .parse(await body(request));
    const count = await env.DB.prepare(
      "SELECT COUNT(*) n FROM memories WHERE uid=?",
    )
      .bind(user.uid)
      .first<{ n: number }>();
    const old = await env.DB.prepare(
      "SELECT id FROM memories WHERE uid=? AND id=?",
    )
      .bind(user.uid, input.id)
      .first();
    if (!old && (count?.n || 0) >= 100)
      throw new ApiError(400, "You can save up to 100 memories.");
    await env.DB.prepare(
      "INSERT INTO memories VALUES(?,?,?,?) ON CONFLICT(uid,id) DO UPDATE SET text=excluded.text,updated_at=excluded.updated_at",
    )
      .bind(user.uid, input.id, input.text, Date.now())
      .run();
    return json({ saved: true });
  }
  const memoryPath = path.match(/^\/api\/memories\/([a-zA-Z0-9-]+)$/);
  if (memoryPath && method === "DELETE") {
    await env.DB.prepare("DELETE FROM memories WHERE uid=? AND id=?")
      .bind(user.uid, memoryPath[1])
      .run();
    return json({ deleted: true });
  }
  if (path === "/api/consent" && method === "GET")
    return json({
      consent: !!(
        await env.DB.prepare("SELECT consent FROM profiles WHERE uid=?")
          .bind(user.uid)
          .first<{ consent: number }>()
      )?.consent,
    });
  if (path === "/api/consent" && method === "PUT") {
    const input = z
      .object({ consent: z.boolean() })
      .strict()
      .parse(await body(request));
    await env.DB.prepare(
      "INSERT INTO profiles(uid,consent) VALUES(?,?) ON CONFLICT(uid) DO UPDATE SET consent=excluded.consent",
    )
      .bind(user.uid, input.consent ? 1 : 0)
      .run();
    if (!input.consent)
      await env.DB.prepare("DELETE FROM examples WHERE uid=?")
        .bind(user.uid)
        .run();
    return json({ saved: true });
  }
  if (path === "/api/examples" && method === "POST") {
    const input = z
      .object({ messageId: idSchema })
      .strict()
      .parse(await body(request));
    const consent = await env.DB.prepare(
      "SELECT consent FROM profiles WHERE uid=?",
    )
      .bind(user.uid)
      .first<{ consent: number }>();
    if (!consent?.consent)
      throw new ApiError(
        403,
        "Enable example-sharing consent in Settings first.",
      );
    const message = await env.DB.prepare(
      "SELECT id FROM messages WHERE uid=? AND id=? AND role='assistant' AND status='complete'",
    )
      .bind(user.uid, input.messageId)
      .first();
    if (!message) throw new ApiError(404, "Reply not found.");
    await env.DB.prepare("INSERT OR IGNORE INTO examples VALUES(?,?,?)")
      .bind(user.uid, input.messageId, Date.now())
      .run();
    return json({ shared: true });
  }
  if (path === "/api/announcements" && method === "GET")
    return json(
      (
        await env.DB.prepare(
          "SELECT a.*,EXISTS(SELECT 1 FROM notice_reads r WHERE r.uid=? AND r.id=a.id) AS read FROM announcements a ORDER BY created_at DESC LIMIT 100",
        )
          .bind(user.uid)
          .all()
      ).results,
    );
  if (path === "/api/announcements/read" && method === "POST") {
    const input = z
      .object({ id: idSchema })
      .strict()
      .parse(await body(request));
    await env.DB.prepare("INSERT OR IGNORE INTO notice_reads VALUES(?,?)")
      .bind(user.uid, input.id)
      .run();
    return json({ read: true });
  }
  if (path === "/api/update" && method === "GET")
    return json((await getConfig(env)).release);
  throw new ApiError(404, "Endpoint not found.");
}
export function trustedRelease(value: string, repo: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      ((url.hostname === "kitty-ai-v2.kitty-ai.workers.dev" && /^\/downloads\/KITTY-AI-[0-9]+(?:\.[0-9]+){1,3}\.apk$/.test(url.pathname)) ||
      (url.hostname === "github.com" && new RegExp(`^/${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/releases/download/[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*\\.apk$`).test(url.pathname)))
    );
  } catch {
    return false;
  }
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    let response: Response;
    try {
      response = await route(request, env, ctx);
    } catch (error) {
      if (error instanceof ApiError)
        response = json({ error: error.message }, error.status);
      else if (error instanceof z.ZodError)
        response = json(
          {
            error: "Invalid input.",
            details: error.issues.map((i) => ({
              path: i.path,
              message: i.message,
            })),
          },
          400,
        );
      else response = json({ error: "Something went wrong. Please try again." }, 500);
    }
    const headers = new Headers(response.headers);
    for (const [key,value] of Object.entries(browserCors(request))) headers.set(key,value);
    return new Response(response.body, {status:response.status,headers});
  },
} satisfies ExportedHandler<Env>;
