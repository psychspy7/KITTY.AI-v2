import { ApiError, type Message, type Provider, type Env } from "./types";
import { unseal } from "./vault";
export const CLOUDFLARE_MODELS = ["@cf/meta/llama-3.1-8b-instruct-fp8"] as const;
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
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line.startsWith("data:")) yield line.slice(5).trimStart();
      }
      if (done) {
        if (buffer.startsWith("data:")) yield buffer.slice(5).trim();
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
  } else {
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
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new ApiError(502, `Provider unavailable (HTTP ${response.status}).`);
  }
  let complete = false;
  for await (const data of sseData(response.body)) {
    if (data === "[DONE]") {
      complete = true;
      break;
    }
    const event = JSON.parse(data);
    if (event.error) throw new ApiError(502, "Provider interrupted the reply.");
    if (provider.kind === "cloudflare") {
      if (event.response) yield event.response;
    } else if (provider.kind === "groq") {
      const choice = event.choices?.[0];
      const value = choice?.delta?.content;
      if (value) yield value;
      if (choice?.finish_reason) complete = true;
    } else {
      const candidate = event.candidates?.[0];
      for (const part of candidate?.content?.parts || [])
        if (part.text && !part.thought) yield part.text;
      if (candidate?.finishReason) complete = true;
    }
  }
  if (!complete)
    throw new ApiError(
      502,
      "Provider stream ended early. Retry after reconnecting.",
    );
}
export async function speech(
  provider: Provider,
  env: Env,
  text: string,
  model: string,
  voice: string,
  signal: AbortSignal,
): Promise<{ data: string; mimeType: string }> {
  if (provider.kind !== "gemini")
    throw new ApiError(400, "Speech requires a Gemini provider.");
  const key = await unseal(provider.encrypted_key, env.VAULT_KEY, provider.id);
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
    throw new ApiError(502, "Speech is unavailable. Try again later.");
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
  if (!audio?.data || (audio.mime_type && audio.mime_type !== "audio/wav"))
    throw new ApiError(502, "Unsupported speech response.");
  return { data: audio.data, mimeType: "audio/wav" };
}
