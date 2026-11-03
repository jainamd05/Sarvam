/**
 * Sarvam voice session for ELYSIA.
 *
 * Sarvam has no single realtime session, so this builds one from its services:
 *   mic PCM -> Saaras realtime STT -> chat completions (with tools) -> Bulbul TTS -> PCM
 *
 * It exposes the same small surface index.ts already drives (sendRealtimeInput,
 * sendToolResponse, close, and onmessage events), so tool dispatch is unchanged.
 */

import WebSocket from "ws";

/** JSON Schema type names, used by the tool declarations and the memory schema. */
export const Type = {
  OBJECT: "object",
  ARRAY: "array",
  STRING: "string",
  NUMBER: "number",
  INTEGER: "integer",
  BOOLEAN: "boolean",
} as const;

export interface FunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LiveServerMessage {
  serverContent?: {
    modelTurn?: { parts?: Array<{ text?: string; inlineData?: { data: string } }> };
    userTurn?: { parts?: Array<{ text?: string }> };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  toolCall?: { functionCalls?: FunctionCall[] };
}

interface LiveCallbacks {
  onmessage: (message: LiveServerMessage) => void;
  onclose: (e: { code?: number; reason?: string; wasClean?: boolean }) => void;
  onerror: (error: Error) => void;
}

interface FunctionDeclaration {
  name: string;
  description?: string;
  parameters?: unknown;
}

interface ConnectOptions {
  model: string;
  config: {
    speechConfig?: { voiceConfig?: { prebuiltVoiceConfig?: { voiceName?: string } } };
    systemInstruction: string;
    tools: Array<{ functionDeclarations: FunctionDeclaration[] }>;
  };
  callbacks: LiveCallbacks;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
const baseUrl = () => env("SARVAM_BASE_URL", "https://api.sarvam.ai").replace(/\/$/, "");

export const sarvamChatModel = () => env("SARVAM_MODEL", "glm5.3-flash");
const memoryModel = () => env("SARVAM_MEMORY_MODEL", sarvamChatModel());
const sttModel = () => env("SARVAM_STT_MODEL", "saaras:v3-realtime");
const ttsModel = () => env("SARVAM_TTS_MODEL", "bulbul:v3");

export const OUTPUT_SAMPLE_RATE = 24000; // audio.ts plays model audio at this rate
export const DEFAULT_SPEAKER = "shubh";
const SPEAKERS = new Set(["shubh", "aditya", "rahul", "rohan", "amit", "dev", "kabir", "priya", "neha", "pooja", "simran", "kavya", "ishita", "shreya"]);

const MAX_TOOL_ROUNDS = 8;
const MAX_HISTORY = 40;
const TOOL_TIMEOUT_MS = 120_000;
const MAX_TOOL_OUTPUT_CHARS = 20_000;
const FRAME_MAX_AGE_MS = 15_000;
const TTS_LANGUAGES = new Set(["hi-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "mr-IN", "gu-IN", "pa-IN", "or-IN", "en-IN"]);

function headers(apiKey: string): Record<string, string> {
  return {
    "api-subscription-key": apiKey,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function requireOk(res: Response): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(`Sarvam API ${res.status}: ${body.slice(0, 300)}`);
}

/** Rejects only when Sarvam says the key is bad. Other failures surface on first use. */
export async function validateSarvamKey(apiKey: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/v2/chat/completions`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ model: sarvamChatModel(), messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
  });
  if (res.status === 401 || res.status === 403) throw new Error("INVALID_SARVAM_KEY");
}

/** One-shot JSON completion, used for memory consolidation. */
export async function sarvamStructuredJson(apiKey: string, prompt: string, schema: unknown): Promise<string> {
  const res = await fetch(`${baseUrl()}/v2/chat/completions`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: memoryModel(),
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: "memory_transactions", schema } },
    }),
  });
  await requireOk(res);
  const data: any = await res.json();
  return (data?.choices?.[0]?.message?.content || "{}").trim();
}

function toChatTools(tools: ConnectOptions["config"]["tools"]) {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const group of tools) {
    for (const fn of group.functionDeclarations) {
      if (seen.has(fn.name)) continue;
      seen.add(fn.name);
      out.push({
        type: "function",
        function: {
          name: fn.name,
          description: fn.description || "",
          parameters: fn.parameters || { type: "object", properties: {} },
        },
      });
    }
  }
  return out;
}

/** Latin text is spoken as Indian English; other scripts use the detected language. */
export function ttsLanguageFor(text: string, detected?: string): string {
  if (!/[^\u0000-ɏ -⁯₠-⃏]/.test(text)) return "en-IN";
  return detected && TTS_LANGUAGES.has(detected) ? detected : "hi-IN";
}

function speakable(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/[*_#`>~]/g, "").replace(/\s+/g, " ").trim();
}

/** Splits streamed text into sentences so speech can start before the reply finishes. */
export class SentenceChunker {
  private buffer = "";
  constructor(private emit: (sentence: string) => void, private maxChars = 240) {}

  push(text: string): void {
    this.buffer += text;
    for (;;) {
      const match = /[.!?।]+["')\]]*\s|\n+/.exec(this.buffer);
      let end = match ? match.index + match[0].length : -1;
      if (end < 0 && this.buffer.length > this.maxChars) {
        const space = this.buffer.lastIndexOf(" ", this.maxChars);
        end = space > 0 ? space + 1 : this.maxChars;
      }
      if (end < 0) return;
      const sentence = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end);
      if (sentence) this.emit(sentence);
    }
  }

  flush(): void {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (rest) this.emit(rest);
  }
}

/** Converts a binary PCM stream to even-length chunks, dropping any WAV header. */
export class Pcm16Stream {
  private carry = Buffer.alloc(0);
  private headerChecked = false;

  push(chunk: Buffer): Buffer | null {
    let data = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    this.carry = Buffer.alloc(0);
    if (!this.headerChecked) {
      if (data.length < 12) {
        this.carry = data;
        return null;
      }
      if (data.subarray(0, 4).toString("latin1") === "RIFF") {
        const at = data.indexOf("data", 12, "latin1");
        if (at < 0 || data.length < at + 8) {
          this.carry = data;
          return null;
        }
        data = data.subarray(at + 8);
      }
      this.headerChecked = true;
    }
    if (data.length % 2) {
      this.carry = data.subarray(data.length - 1);
      data = data.subarray(0, data.length - 1);
    }
    return data.length ? data : null;
  }
}

export class SarvamLiveSession {
  private stt!: WebSocket;
  private readonly tools: unknown[];
  private readonly speaker: string;
  private history: ChatMessage[] = [];
  private turn: AbortController | null = null;
  private pendingTools = new Map<string, (output: unknown) => void>();
  private latestFrame: { data: string; at: number } | null = null;
  private detectedLanguage: string | undefined;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private callCounter = 0;
  private micFrames = 0;
  private micPeak = 0;
  private micLoggedAt = Date.now();
  private sawPartial = false;

  constructor(private apiKey: string, private options: ConnectOptions) {
    this.tools = toChatTools(options.config.tools);
    const voice = options.config.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName?.toLowerCase() || "";
    this.speaker = SPEAKERS.has(voice) ? voice : DEFAULT_SPEAKER;
  }

  async open(): Promise<void> {
    const params = new URLSearchParams({
      language_code: env("SARVAM_STT_LANGUAGE", "auto"),
      model: sttModel(),
      stream_type: "fast",
      mode: env("SARVAM_STT_MODE", "codemix"),
      endpointing: "vad",
      encoding: "linear16",
      sample_rate: "16000",
    });
    const url = `${baseUrl().replace(/^http/, "ws")}/speech-to-text-realtime/ws?${params}`;
    this.stt = new WebSocket(url, { headers: { "api-subscription-key": this.apiKey } });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Sarvam speech-to-text.")), 15_000);
      this.stt.once("open", () => { clearTimeout(timer); resolve(); });
      this.stt.once("error", (err) => { clearTimeout(timer); reject(err); });
    });

    this.stt.on("message", (raw) => this.onSttMessage(raw.toString()));
    this.stt.on("error", (err) => { if (!this.closed) this.options.callbacks.onerror(err); });
    this.stt.on("close", (code, reason) => {
      this.stopPing();
      if (!this.closed) {
        this.closed = true;
        this.cancelTurn();
        this.options.callbacks.onclose({ code, reason: reason.toString(), wasClean: code === 1000 });
      }
    });
    this.pingTimer = setInterval(() => this.sendStt({ event: "ping" }), 25_000);
  }

  sendRealtimeInput(input: { audio?: { data: string; mimeType?: string }; video?: { data: string; mimeType?: string } }): void {
    if (input.audio) {
      this.noteMicLevel(input.audio.data);
      this.sendStt({ event: "audio_input", audio: input.audio.data });
    }
    if (input.video) this.latestFrame = { data: input.video.data, at: Date.now() };
  }

  sendToolResponse(payload: { functionResponses: Array<{ id?: string; name?: string; response?: unknown }> }): void {
    for (const r of payload.functionResponses) {
      const resolve = r.id ? this.pendingTools.get(r.id) : undefined;
      if (resolve) resolve((r.response as any)?.output ?? r.response);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopPing();
    this.cancelTurn();
    this.sendStt({ event: "end" });
    try { this.stt.close(1000); } catch { /* already closed */ }
  }

  /** Logs mic loudness every few seconds, so a silent or muted mic is obvious. Peak is 0-32767. */
  private noteMicLevel(base64: string) {
    const pcm = Buffer.from(base64, "base64");
    for (let i = 0; i + 1 < pcm.length; i += 2) this.micPeak = Math.max(this.micPeak, Math.abs(pcm.readInt16LE(i)));
    this.micFrames++;
    if (Date.now() - this.micLoggedAt >= 5000) {
      console.log(`[Sarvam Mic] frames=${this.micFrames} peak=${this.micPeak}`);
      this.micLoggedAt = Date.now();
      this.micFrames = 0;
      this.micPeak = 0;
    }
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private sendStt(message: object) {
    if (this.stt?.readyState === WebSocket.OPEN) this.stt.send(JSON.stringify(message));
  }

  private emit(message: LiveServerMessage) {
    if (!this.closed) this.options.callbacks.onmessage(message);
  }

  private onSttMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.language) this.detectedLanguage = msg.language;

    if (msg.event === "vad.speech_start" || msg.event === "vad.speech_end" || msg.event === "session.end") {
      console.log(`[Sarvam STT] ${msg.event}`);
    }

    if (msg.event === "transcript.partial") {
      if (msg.text?.trim()) {
        if (!this.sawPartial) console.log("[Sarvam STT] first partial transcript");
        this.sawPartial = true;
        this.bargeIn();
      }
    } else if (msg.event === "transcript.final") {
      this.sawPartial = false;
      const text = msg.text?.trim();
      console.log(`[Sarvam STT] final transcript: ${JSON.stringify(text || "")}`);
      if (!text) return;
      this.bargeIn();
      this.emit({ serverContent: { userTurn: { parts: [{ text }] } } });
      void this.runTurn(text);
    } else if (msg.event === "error") {
      console.error(`[Sarvam STT] ${msg.code}: ${msg.message}`);
      if (msg.is_fatal) this.options.callbacks.onerror(new Error(`Sarvam speech-to-text: ${msg.message}`));
    }
  }

  private bargeIn() {
    if (!this.turn) return;
    console.log("[Sarvam] Reply cancelled because speech was detected (barge-in)");
    this.cancelTurn();
    this.emit({ serverContent: { interrupted: true } });
  }

  private cancelTurn() {
    this.turn?.abort();
    this.turn = null;
    for (const resolve of this.pendingTools.values()) resolve({ error: "Cancelled: the user interrupted." });
    this.pendingTools.clear();
  }

  private async runTurn(userText: string): Promise<void> {
    const controller = new AbortController();
    this.turn = controller;
    const { signal } = controller;
    const added: ChatMessage[] = [{ role: "user", content: userText }];
    const frame = this.latestFrame && Date.now() - this.latestFrame.at < FRAME_MAX_AGE_MS ? this.latestFrame.data : null;
    let spoken = "";
    const startedAt = Date.now();
    console.log(`[Sarvam] Turn started (model=${this.options.model})`);

    let speech: Promise<void> = Promise.resolve();
    const chunker = new SentenceChunker((sentence) => {
      speech = speech.then(() => (signal.aborted ? undefined : this.speak(sentence, signal)));
    });

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const { content, toolCalls } = await this.streamChat(added, frame, signal, (delta) => {
          if (!spoken) console.log(`[Sarvam] First reply text after ${Date.now() - startedAt}ms`);
          spoken += delta;
          this.emit({ serverContent: { modelTurn: { parts: [{ text: delta }] } } });
          chunker.push(delta);
        });
        added.push({ role: "assistant", content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
        if (!toolCalls.length) break;
        chunker.flush();
        added.push(...await this.runTools(toolCalls, signal));
        if (signal.aborted) return;
      }
      chunker.flush();
      await speech;
      if (signal.aborted) return;
      this.commit(added);
      this.turn = null;
      console.log(`[Sarvam] Turn done in ${Date.now() - startedAt}ms, reply ${spoken.length} chars`);
      this.emit({ serverContent: { turnComplete: true } });
    } catch (err: any) {
      if (signal.aborted || err?.name === "AbortError") return;
      this.turn = null;
      console.error("[Sarvam] Turn failed:", err?.message || err);
      this.options.callbacks.onerror(err instanceof Error ? err : new Error(String(err)));
    } finally {
      // Keep what was actually said, without half-finished tool calls.
      if (signal.aborted && spoken.trim()) {
        this.commit([{ role: "user", content: userText }, { role: "assistant", content: spoken }]);
      }
    }
  }

  private commit(messages: ChatMessage[]) {
    this.history.push(...messages);
    if (this.history.length > MAX_HISTORY) {
      let start = this.history.length - MAX_HISTORY;
      while (start < this.history.length && this.history[start].role !== "user") start++;
      this.history = this.history.slice(start);
    }
  }

  private async runTools(toolCalls: any[], signal: AbortSignal): Promise<ChatMessage[]> {
    const calls: FunctionCall[] = toolCalls.map((c) => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* model sent invalid JSON */ }
      return { id: c.id, name: c.function.name, args };
    });
    const results = calls.map((call) => new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => resolve({ error: `Tool ${call.name} timed out.` }), TOOL_TIMEOUT_MS);
      this.pendingTools.set(call.id, (output) => {
        clearTimeout(timer);
        this.pendingTools.delete(call.id);
        resolve(output);
      });
    }));
    this.emit({ toolCall: { functionCalls: calls } });
    const outputs = await Promise.all(results);
    if (signal.aborted) return [];
    return calls.map((call, i) => ({
      role: "tool" as const,
      tool_call_id: call.id,
      content: (JSON.stringify(outputs[i] ?? { result: "Done." })).slice(0, MAX_TOOL_OUTPUT_CHARS),
    }));
  }

  private async streamChat(
    added: ChatMessage[],
    frame: string | null,
    signal: AbortSignal,
    onText: (delta: string) => void,
  ): Promise<{ content: string; toolCalls: any[] }> {
    const turnMessages = added.map((m, i) =>
      i === 0 && frame
        ? { ...m, content: [{ type: "text", text: m.content }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frame}` } }] }
        : m,
    );
    const effort = process.env.SARVAM_REASONING_EFFORT?.trim();
    const res = await fetch(`${baseUrl()}/v2/chat/completions`, {
      method: "POST",
      headers: headers(this.apiKey),
      signal,
      body: JSON.stringify({
        model: this.options.model,
        stream: true,
        messages: [{ role: "system", content: this.systemPrompt() }, ...this.history, ...turnMessages],
        tools: this.tools,
        tool_choice: "auto",
        ...(effort ? { reasoning_effort: effort } : {}),
      }),
    });
    await requireOk(res);

    let content = "";
    const calls: any[] = [];
    let buffer = "";
    const decoder = new TextDecoder();
    const handleLine = (line: string) => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let delta: any;
      try { delta = JSON.parse(data)?.choices?.[0]?.delta; } catch { return; }
      if (delta?.content) {
        content += delta.content;
        onText(delta.content);
      }
      for (const tc of delta?.tool_calls || []) {
        const slot = (calls[tc.index ?? 0] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.function.name += tc.function.name;
        if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
      }
    };
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach(handleLine);
    }
    handleLine(buffer);

    const toolCalls = calls.filter((c) => c?.function?.name);
    for (const c of toolCalls) if (!c.id) c.id = `call_${++this.callCounter}`;
    return { content, toolCalls };
  }

  private systemPrompt(): string {
    return `${this.options.config.systemInstruction}\n\nYour replies are spoken aloud through text-to-speech. Use short, natural sentences. No markdown, lists or code unless the user asks to see them.`;
  }

  private async speak(sentence: string, signal: AbortSignal): Promise<void> {
    const text = speakable(sentence);
    if (!text) return;
    const res = await fetch(`${baseUrl()}/text-to-speech/stream`, {
      method: "POST",
      headers: headers(this.apiKey),
      signal,
      body: JSON.stringify({
        text,
        language_code: ttsLanguageFor(text, this.detectedLanguage),
        speaker: this.speaker,
        model: ttsModel(),
        output_audio_codec: "linear16",
        speech_sample_rate: OUTPUT_SAMPLE_RATE,
      }),
    });
    await requireOk(res);
    const pcm = new Pcm16Stream();
    let bytes = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      const out = pcm.push(Buffer.from(chunk));
      if (out) {
        bytes += out.length;
        this.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: out.toString("base64") } }] } } });
      }
    }
    console.log(`[Sarvam TTS] Sent ${(bytes / (OUTPUT_SAMPLE_RATE * 2)).toFixed(1)}s of audio to the browser`);
  }
}

/** Same call shape index.ts used for the previous live client. */
export class SarvamLiveClient {
  constructor(private apiKey: string) {}

  live = {
    connect: async (options: ConnectOptions): Promise<SarvamLiveSession> => {
      const session = new SarvamLiveSession(this.apiKey, options);
      await session.open();
      return session;
    },
  };
}
