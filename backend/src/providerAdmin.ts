import {z} from "zod";
import {seal} from "./vault";
import {chat,speech,safeProviderError,CLOUDFLARE_MODELS,CLOUDFLARE_SPEECH,FISH_MODELS,isGroqChatModel} from "./providers";
import {ApiError,type Env,type Provider} from "./types";
import {getConfig} from "./config";

export const providerInputSchema=z.object({
  id:z.string().regex(/^[a-z0-9-]{1,40}$/),
  kind:z.enum(["groq","gemini","cloudflare","elevenlabs","fish"]),
  model:z.string().regex(/^[a-zA-Z0-9@._/-]+$/).max(120),
  enabled:z.boolean().default(true),key:z.string().min(10).max(512).optional(),
}).strict();
export async function candidateProvider(env:Env,input:z.infer<typeof providerInputSchema>) {
  const old=await env.DB.prepare("SELECT * FROM providers WHERE id=?").bind(input.id).first<Provider>();
  if(input.kind==="groq"&&!isGroqChatModel(input.model))throw new ApiError(400,"Choose a Groq text chat model, not a speech model.");
  if(input.kind==="cloudflare"&&(!env.AI||![...CLOUDFLARE_MODELS,CLOUDFLARE_SPEECH].includes(input.model as any)))throw new ApiError(400,"Choose a supported Cloudflare model with the AI binding connected.");
  if(input.kind==="fish"&&!FISH_MODELS.includes(input.model))throw new ApiError(400,"Choose an exact Fish model; s2.1-pro-free avoids the paid-model default.");
  if(input.kind!=="cloudflare"&&!input.key&&(!old||old.kind!==input.kind))throw new ApiError(400,"A new provider needs its API key.");
  const encrypted=input.kind==="cloudflare"?"":input.key?await seal(input.key,env.VAULT_KEY,input.id):old!.encrypted_key;
  return {id:input.id,kind:input.kind,model:input.model,enabled:input.enabled?1:0,encrypted_key:encrypted} as Provider;
}
export function providerWrite(env:Env,p:Provider) {
  return env.DB.prepare("INSERT INTO providers VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,model=excluded.model,enabled=excluded.enabled,encrypted_key=excluded.encrypted_key").bind(p.id,p.kind,p.model,p.enabled,p.encrypted_key);
}
export async function testProvider(env:Env,data:unknown) {
  const input=providerInputSchema.extend({mode:z.enum(["chat","speech"]),voice:z.string().regex(/^[a-zA-Z0-9_-]{0,80}$/).default(""),save:z.boolean().default(false)}).strict().parse(data);
  const p=await candidateProvider(env,input), started=Date.now();
  let ok=false,error="",errorType="",preview="",audio: {data:string;mimeType:string}|undefined;
  try {
    const signal=AbortSignal.timeout(45000);
    if(input.mode==="speech") audio=await speech(p,env,"Hello, Sir. KITTY is ready to speak.",input.model,input.voice,signal);
    else {
      const config=await getConfig(env);
      for await(const delta of chat(p,env,[{role:"system",content:config.corePrompt},{role:"user",content:"Say hello KITTY in one short sentence."}],Math.min(config.maxOutputTokens,1024),signal)) {
        preview+=delta; if(preview.length>4000)throw new ApiError(502,"Test reply exceeded its safe limit.");
      }
    }
    ok=true;
  } catch(e) {error=safeProviderError(e,p.kind).message;errorType=e instanceof Error?e.name:"Unknown";}
  const durationMs=Date.now()-started;
  const old=await env.DB.prepare("SELECT kind,model FROM providers WHERE id=?").bind(p.id).first<Provider>();
  const statements:D1PreparedStatement[]=[];
  if(ok&&input.save) {
    statements.push(providerWrite(env,p),env.DB.prepare("DELETE FROM provider_checks WHERE provider_id=?").bind(p.id));
  }
  if((ok&&input.save)||(old?.kind===p.kind&&old.model===p.model&&!input.key))
    statements.push(env.DB.prepare("INSERT INTO provider_checks VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider_id,mode) DO UPDATE SET tested_at=excluded.tested_at,ok=excluded.ok,model=excluded.model,duration_ms=excluded.duration_ms,error=excluded.error,error_type=excluded.error_type").bind(p.id,input.mode,Date.now(),ok?1:0,p.model,durationMs,error,errorType));
  if(statements.length)await env.DB.batch(statements);
  return {ok,saved:ok&&input.save,provider:p.id,kind:p.kind,model:p.model,mode:input.mode,durationMs,preview:preview.slice(0,320),...(audio?{audio}:{}),...(error?{error,errorType}:{})};
}
