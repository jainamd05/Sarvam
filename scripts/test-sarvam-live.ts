/**
 * Live check against the real Sarvam API using SARVAM_API_KEY from .env.
 * Spends a small amount of credit. Prints timings; never prints the key.
 *
 *   npx tsx scripts/test-sarvam-live.ts
 */
import "dotenv/config";
import { WebSocket } from "ws";
import { sarvamChatModel, sarvamStructuredJson, Pcm16Stream } from "../src/server/sarvam";

const key = process.env.SARVAM_API_KEY?.trim();
if (!key) {
  console.error("NOT VERIFIED: SARVAM_API_KEY is not set in .env");
  process.exit(2);
}
const BASE = (process.env.SARVAM_BASE_URL || "https://api.sarvam.ai").replace(/\/$/, "");
const headers = { "api-subscription-key": key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
let failed = 0;

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  const start = Date.now();
  try {
    console.log(`PASS ${name} (${Date.now() - start + 0}ms start) -> ${await fn()} [${Date.now() - start}ms]`);
  } catch (e: any) {
    failed++;
    const cause = e?.cause ? ` | cause: ${e.cause.code || ""} ${e.cause.message || e.cause}` : "";
    console.log(`FAIL ${name}: ${`${e?.message || e}${cause}`.split(key!).join("***")}`);
  }
}

async function post(path: string, body: object) {
  const res = await fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 400)}`);
  return res;
}

async function main() {
  console.log(`model=${sarvamChatModel()}`);

  await check("chat reply", async () => {
    const data: any = await (await post("/v2/chat/completions", {
      model: sarvamChatModel(),
      messages: [{ role: "user", content: "Reply with exactly one word: ready" }],
    })).json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("empty reply");
    return JSON.stringify(text.slice(0, 40));
  });

  await check("chat tool call", async () => {
    const data: any = await (await post("/v2/chat/completions", {
      model: sarvamChatModel(),
      messages: [{ role: "user", content: "What's the weather in Pune? Use the tool." }],
      tools: [{ type: "function", function: { name: "getWeather", description: "Get weather", parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] } } }],
      tool_choice: "auto",
    })).json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (call?.function?.name !== "getWeather") throw new Error(`no tool call: ${JSON.stringify(data.choices?.[0]?.message).slice(0, 200)}`);
    return call.function.arguments;
  });

  await check("memory JSON", async () => {
    const out = await sarvamStructuredJson(key!, 'Return {"ok": true}', { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] });
    if (JSON.parse(out).ok !== true) throw new Error(out.slice(0, 200));
    return out;
  });

  await check("TTS stream at 24 kHz PCM", async () => {
    const start = Date.now();
    const res = await post("/text-to-speech/stream", {
      text: "Elysia is now running on Sarvam.", language_code: "en-IN", speaker: "shubh",
      model: process.env.SARVAM_TTS_MODEL || "bulbul:v3", output_audio_codec: "linear16", speech_sample_rate: 24000,
    });
    let bytes = 0, first = 0, wav = false;
    const pcm = new Pcm16Stream();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!first) { first = Date.now() - start; wav = Buffer.from(chunk).subarray(0, 4).toString("latin1") === "RIFF"; }
      bytes += pcm.push(Buffer.from(chunk))?.length || 0;
    }
    if (!bytes) throw new Error("no audio");
    return `${res.headers.get("content-type")}, ${(bytes / 48000).toFixed(1)}s audio, first byte ${first}ms, wavHeader=${wav}`;
  });

  await check("STT realtime from synthesized speech", async () => {
    const res = await post("/text-to-speech/stream", {
      text: "Please open the calculator.", language_code: "en-IN", speaker: "shubh",
      model: process.env.SARVAM_TTS_MODEL || "bulbul:v3", output_audio_codec: "linear16", speech_sample_rate: 16000,
    });
    const pcm = new Pcm16Stream();
    const parts: Buffer[] = [];
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) { const o = pcm.push(Buffer.from(chunk)); if (o) parts.push(o); }
    const audio = Buffer.concat([...parts, Buffer.alloc(32000)]); // trailing silence lets VAD end the turn

    return await new Promise<string>((resolve, reject) => {
      const params = new URLSearchParams({ language_code: "en-IN", model: "saaras:v3-realtime", stream_type: "fast", encoding: "linear16", sample_rate: "16000" });
      const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/speech-to-text-realtime/ws?${params}`, { headers: { "api-subscription-key": key! } });
      const seen: string[] = [];
      const timer = setTimeout(() => { ws.close(); reject(new Error(`no final transcript in 25s; audio ${audio.length} bytes; events: ${seen.join(" ; ") || "none"}`)); }, 25000);
      let sender: ReturnType<typeof setInterval>;
      ws.on("error", (e) => { clearTimeout(timer); reject(e); });
      ws.on("open", () => {
        let at = 0;
        sender = setInterval(() => {
          // A live mic never stops, so keep sending silence after the speech ends.
          const frame = at < audio.length ? audio.subarray(at, at + 3200) : Buffer.alloc(3200);
          ws.send(JSON.stringify({ event: "audio_input", audio: frame.toString("base64") }));
          at += 3200;
        }, 100);
      });
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        seen.push(JSON.stringify(m).slice(0, 160));
        if (m.event === "transcript.final") { clearTimeout(timer); clearInterval(sender); ws.close(); resolve(JSON.stringify(m.text)); }
        if (m.event === "error" && m.is_fatal) { clearTimeout(timer); clearInterval(sender); ws.close(); reject(new Error(m.message)); }
      });
    });
  });

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll live checks passed");
  process.exit(failed ? 1 : 0);
}

main();
