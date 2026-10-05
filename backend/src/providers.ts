import { ApiError, type Message, type Provider, type Env } from "./types";
import { unseal } from "./vault";
export const CLOUDFLARE_MODELS = ["@cf/meta/llama-3.1-8b-instruct-fp8"] as const;
export const CLOUDFLARE_SPEECH = "@cf/myshell-ai/melotts";
export const FISH_MODELS = ["s2.1-pro-free", "s2.1-pro", "s2-pro", "s1", "drama-3-preview"];
export function providerHttpError(kind: string, status: number): ApiError {
  const name = {groq:"Groq", gemini:"Gemini", cloudflare:"Cloudflare", elevenlabs:"ElevenLabs", fish:"Fish Audio"}[kind] || "Provider";
  if (status === 429) return new ApiError(429, `${name} rate limit reached. Wait and retry, or select the free Cloudflare provider.`);
  if (status === 401 || status === 403) return new ApiError(502, `${name} rejected the API key or account permissions. Test this provider in the owner console.`);
  if (status === 402) return new ApiError(502, `${name} needs available credits. Choose a free model or check the account balance.`);
  if (status === 400 || status === 404) return new ApiError(502, `${name} rejected the model or voice settings. Test the configuration in the owner console.`);
  return new ApiError(502, `${name} is unavailable (HTTP ${status}). Try again later.`);
}
export function safeProviderError(error: unknown, kind: string): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DOMException && error.name === "OperationError")
    return new ApiError(503, "The saved provider key could not be decrypted. Re-enter it in the owner console; preserve the vault key.");
  return new ApiError(502, `${kind} could not finish the request. Run Test in the owner console to check this provider.`);
}
export function isGroqChatModel(id: string) {
  return !/whisper|orpheus|playai|tts|speech|embed/i.test(id);
}
export function cloudflareContext(messages: Message[]): Message[] {
  const encoder = new TextEncoder();
  const systems = messages.filter(m => m.role === "system");
  let bytes = systems.reduce((n, m) => n + encoder.encode(m.content).length, 0);
  const recent: Message[] = [];
  const conversation = messages.filter(m => m.role !== "system");
  for (let i = conversation.length - 1; i >= 0; i--) {
    const size = encoder.encode(conversation[i].content).length;
    if (bytes + size > 24000) {
      if (!recent.length) throw new ApiError(400, "This prompt is too long for the free model. Shorten it or ask the owner to select Groq.");
      break;
    }
    bytes += size;
    recent.unshift(conversation[i]);
  }
  while (recent[0]?.role === "assistant") recent.shift();
  return [...systems, ...recent];
}
export async function* sseData(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  let lines: string[] = [];
  let frameSize=0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line.startsWith("data:")) { frameSize+=line.length; if(frameSize>262144)throw new ApiError(502,"Provider sent an oversized stream event."); lines.push(line.slice(5).replace(/^ /, "")); }
        if (line === "" && lines.length) { yield lines.join("\n"); lines = []; frameSize=0; }
      }
      if (done) {
        if (buffer.startsWith("data:")) lines.push(buffer.slice(5).replace(/^ /, ""));
        if (lines.length) yield lines.join("\n");
        break;
      }
      if (buffer.length > 262144)
        throw new ApiError(502, "Provider returned an invalid stream.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function* chat(
  provider: Provider,
  env: Env,
  messages: Message[],
  maxTokens: number,
  signal: AbortSignal,
): AsyncGenerator<string> {
  let response: Response;
  if (provider.kind === "cloudflare") {
    if (!env.AI) throw new ApiError(503, "Cloudflare AI is not connected.");
    const model = CLOUDFLARE_MODELS.find(m => m === provider.model);
    if (!model) throw new ApiError(400, "Choose a supported free Cloudflare chat model.");
    signal.throwIfAborted();
    const context = cloudflareContext(messages);
    try {
      response = new Response(await env.AI.run(model, {messages:context, stream: true, max_tokens: maxTokens}, {signal}));
    } catch {
      signal.throwIfAborted();
      throw new ApiError(503, "KITTY’s free AI allowance is unavailable or exhausted. Try again later, or ask the owner to configure Groq.");
    }
  } else if (provider.kind === "groq") {
    if (!isGroqChatModel(provider.model)) throw new ApiError(400, "Groq chat requires a text chat model, such as openai/gpt-oss-120b.");
    const key = await unseal(provider.encrypted_key, env.VAULT_KEY, provider.id);
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        stream: true,
        max_completion_tokens: maxTokens,
        ...(provider.model === "openai/gpt-oss-120b" ||
        provider.model === "openai/gpt-oss-20b"
          ? { reasoning_effort: "low", include_reasoning: false }
          : {}),
      }),
      signal,
    });
  } else if (provider.kind === "gemini") {
    const key = await unseal(provider.encrypted_key, env.VAULT_KEY, provider.id);
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages
            .filter((m) => m.role !== "system")
            .map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
          generationConfig: { maxOutputTokens: maxTokens },
        }),
        signal,
      },
    );
  } else throw new ApiError(400, "This provider supports speech, not chat.");
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw providerHttpError(provider.kind, response.status);
  }
  let complete = false;
  let visible = false;
  for await (const data of sseData(response.body)) {
    if (data === "[DONE]") {
      complete = true;
      break;
    }
    let event: any;
    try { event = JSON.parse(data); } catch { throw new ApiError(502, "Provider sent an invalid stream. Test this model in the owner console."); }
    if (event.error) throw new ApiError(502, "Provider interrupted the reply.");
    if (provider.kind === "cloudflare") {
      if (typeof event.response === "string" && event.response) { visible = true; yield event.response; }
    } else if (provider.kind === "groq") {
      const choice = event.choices?.[0];
      const value = choice?.delta?.content;
      if (typeof value === "string" && value) { visible = true; yield value; }
      if (choice?.finish_reason) complete = true;
    } else {
      const candidate = event.candidates?.[0];
      for (const part of candidate?.content?.parts || [])
        if (typeof part.text === "string" && part.text && !part.thought) { visible = true; yield part.text; }
      if (candidate?.finishReason) complete = true;
    }
  }
  if (!complete)
    throw new ApiError(
      502,
      "Provider stream ended early. Retry after reconnecting.",
    );
  if (!visible) throw new ApiError(502, "The model returned no visible answer. Reasoning can exhaust the token budget; increase output tokens or choose Cloudflare or a non-reasoning Groq model.");
}
const MAX_AUDIO = 4 * 1024 * 1024;
function encodeBytes(bytes: Uint8Array) {
  let value = "";
  for (let i=0; i<bytes.length; i+=8192) value += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(value);
}
async function binaryAudio(response: Response, kind: string): Promise<{data:string;mimeType:string}> {
  if (!response.ok) { await response.body?.cancel(); throw providerHttpError(kind, response.status); }
  if (!response.body) throw new ApiError(502, "Speech returned no audio.");
  const reader=response.body.getReader(), chunks:Uint8Array[]=[]; let size=0;
  try { while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>MAX_AUDIO)throw new ApiError(502,"Speech is too long. Ask for a shorter reply."); chunks.push(value); } }
  finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const wav=bytes.length>=12 && new TextDecoder().decode(bytes.subarray(0,4))==="RIFF" && new TextDecoder().decode(bytes.subarray(8,12))==="WAVE";
  const mp3=bytes.length>=3 && (new TextDecoder().decode(bytes.subarray(0,3))==="ID3" || (bytes[0]===255 && (bytes[1]&224)===224));
  if(!wav&&!mp3)throw new ApiError(502,"Speech returned an unsupported audio response.");
  return {data:encodeBytes(bytes),mimeType:wav?"audio/wav":"audio/mpeg"};
}
export async function speech(
  provider: Provider,
  env: Env,
  text: string,
  model: string,
  voice: string,
  signal: AbortSignal,
): Promise<{ data: string; mimeType: string }> {
  if(provider.kind === "cloudflare") {
    if(!env.AI || model !== CLOUDFLARE_SPEECH)throw new ApiError(400,"Choose the supported Cloudflare MeloTTS speech model.");
    if(!["en","fr","es","zh","ja","ko"].includes(voice))throw new ApiError(400,"For MeloTTS, enter a language code: en, fr, es, zh, ja or ko.");
    const audio=await env.AI.run(CLOUDFLARE_SPEECH,{prompt:text,lang:voice},{signal});
    if(audio instanceof ReadableStream || audio instanceof ArrayBuffer || ArrayBuffer.isView(audio)) return binaryAudio(new Response(audio as BodyInit),provider.kind);
    if(audio && typeof audio === "object" && "audio" in audio && typeof audio.audio === "string") {
      if(audio.audio.length>MAX_AUDIO*1.4)throw new ApiError(502,"Speech is too long. Ask for a shorter reply.");
      return binaryAudio(new Response(Uint8Array.from(atob(audio.audio), c=>c.charCodeAt(0))),provider.kind);
    }
    throw new ApiError(502,"Cloudflare returned no supported speech audio.");
  }
  if(provider.kind === "groq")throw new ApiError(400,"Select Gemini, Cloudflare, ElevenLabs or Fish Audio for speech.");
  const key = await unseal(provider.encrypted_key, env.VAULT_KEY, provider.id);
  if(provider.kind === "elevenlabs") {
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(voice))throw new ApiError(400,"Enter an ElevenLabs voice ID.");
    return binaryAudio(await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,{method:"POST",headers:{"xi-api-key":key,"Content-Type":"application/json"},body:JSON.stringify({text,model_id:model}),signal}),provider.kind);
  }
  if(provider.kind === "fish") {
    if(!FISH_MODELS.includes(model))throw new ApiError(400,"Choose an exact supported Fish model. Use s2.1-pro-free for free testing.");
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(voice))throw new ApiError(400,"Enter a Fish Audio voice reference ID.");
    return binaryAudio(await fetch("https://api.fish.audio/v1/tts",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json",model},body:JSON.stringify({text,reference_id:voice,format:"mp3",latency:"normal"}),signal}),provider.kind);
  }
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [
          {
            type: "user_input",
            content: [
              {
                type: "text",
                text,
                annotations: [
                  {
                    type: "speech_metadata",
                    style: "Warm, witty, natural and friendly",
                  },
                ],
              },
            ],
          },
        ],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice }] },
        store: false,
      }),
      signal,
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw providerHttpError(provider.kind, response.status);
  }
  const data = (await response.json()) as {
    steps?: {
      type: string;
      content?: { type: string; data?: string; mime_type?: string }[];
    }[];
  };
  const audio = data.steps
    ?.filter((s) => s.type === "model_output")
    .flatMap((s) => s.content || [])
    .filter((c) => c.type === "audio" && c.data)
    .at(-1);
  if (!audio?.data || audio.data.length>MAX_AUDIO*1.4 || (audio.mime_type && audio.mime_type !== "audio/wav"))
    throw new ApiError(502, "Unsupported speech response.");
  return { data: audio.data, mimeType: "audio/wav" };
}
