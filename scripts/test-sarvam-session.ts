/**
 * Offline test of the Sarvam voice loop against a local fake Sarvam server.
 * Checks request shape and session logic. It does NOT prove the real API works;
 * use test-sarvam-live.ts for that.
 *
 *   npx tsx scripts/test-sarvam-session.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { Pcm16Stream, SarvamLiveClient, SentenceChunker, ttsLanguageFor, type LiveServerMessage } from "../src/server/sarvam";

const KEY = "test-key";
const seen = { chat: [] as any[], tts: [] as any[], sttUrl: "", sttKey: "", audio: 0, ttsAborted: 0 };
let slowTts = false;
let sttClient: WebSocket | null = null;

const sse = (res: http.ServerResponse, deltas: object[]) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of deltas) res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  res.end("data: [DONE]\n\n");
};

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    assert.equal(req.headers["api-subscription-key"], KEY);
    if (req.url === "/v2/chat/completions") {
      seen.chat.push(body);
      const lastRole = body.messages.at(-1).role;
      if (lastRole === "user" && /weather/.test(JSON.stringify(body.messages.at(-1).content))) {
        return sse(res, [
          { content: "Checking. " },
          { tool_calls: [{ index: 0, id: "c1", function: { name: "getWeather", arguments: '{"loc' } }] },
          { tool_calls: [{ index: 0, function: { arguments: 'ation":"Pune"}' } }] },
        ]);
      }
      return sse(res, [{ content: "It is 30 " }, { content: "degrees. All done." }]);
    }
    if (req.url === "/text-to-speech/stream") {
      seen.tts.push(body);
      res.writeHead(200, { "Content-Type": "audio/wav" });
      req.socket.on("close", () => { if (!res.writableEnded) seen.ttsAborted++; });
      const header = Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVEfmt "), Buffer.alloc(20), Buffer.from("data\0\0\0\0")]);
      res.write(Buffer.concat([header, Buffer.from([1, 2, 3])])); // odd length on purpose
      if (slowTts) return; // never finishes, so the turn stays open for barge-in
      setTimeout(() => res.end(Buffer.from([4, 5, 6, 7, 8])), 5);
      return;
    }
    res.writeHead(404).end();
  });
});

const wss = new WebSocketServer({ server, path: "/speech-to-text-realtime/ws" });
wss.on("connection", (ws, req) => {
  seen.sttUrl = req.url || "";
  seen.sttKey = String(req.headers["api-subscription-key"]);
  sttClient = ws;
  ws.on("message", (m) => { if (JSON.parse(m.toString()).event === "audio_input") seen.audio++; });
  ws.send(JSON.stringify({ event: "session.begin" }));
});

const sttSend = (o: object) => sttClient!.send(JSON.stringify(o));
const wait = async (cond: () => boolean, what: string, ms = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};

async function main() {
  // Unit checks
  const said: string[] = [];
  const chunker = new SentenceChunker((s) => said.push(s));
  chunker.push("Hello there. How ar");
  chunker.push("e you? नमस्ते। bye");
  chunker.flush();
  assert.deepEqual(said, ["Hello there.", "How are you?", "नमस्ते।", "bye"]);
  assert.equal(ttsLanguageFor("Hello, world!", "hi-IN"), "en-IN");
  assert.equal(ttsLanguageFor("நன்றி", "ta-IN"), "ta-IN");
  assert.equal(ttsLanguageFor("नमस्ते"), "hi-IN");
  const raw = new Pcm16Stream();
  assert.equal(raw.push(Buffer.alloc(13))!.length, 12);
  assert.equal(raw.push(Buffer.alloc(1))!.length, 2);

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.SARVAM_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;

  const events: LiveServerMessage[] = [];
  let toolEvents = 0;
  const session = await new SarvamLiveClient(KEY).live.connect({
    model: "glm5.3-flash",
    config: {
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Priya" } } },
      systemInstruction: "You are Elysia.",
      tools: [{ functionDeclarations: [
        { name: "getWeather", description: "w", parameters: { type: "object", properties: { location: { type: "string" } } } },
        { name: "getWeather", description: "dup" },
        { name: "noArgs" },
      ] }],
    },
    callbacks: {
      onmessage: (m) => {
        events.push(m);
        for (const fc of m.toolCall?.functionCalls || []) {
          toolEvents++;
          assert.deepEqual(fc.args, { location: "Pune" });
          session.sendToolResponse({ functionResponses: [{ id: fc.id, response: { output: { temp: 30 } } }] });
        }
      },
      onclose: () => {},
      onerror: (e) => { throw e; },
    },
  });

  assert.match(seen.sttUrl, /language_code=auto/);
  assert.match(seen.sttUrl, /model=saaras%3Av3-realtime/);
  assert.match(seen.sttUrl, /mode=codemix/);
  assert.equal(seen.sttKey, KEY);

  session.sendRealtimeInput({ audio: { data: "AAAA" } });
  await wait(() => seen.audio === 1, "audio forwarded to STT");

  // A screen frame is attached to the next user turn only.
  session.sendRealtimeInput({ video: { data: "FRAME" } });
  sttSend({ event: "transcript.final", text: "weather in Pune?", language: "en-IN" });
  await wait(() => events.some((e) => e.serverContent?.turnComplete), "turn complete");

  const text = events.flatMap((e) => e.serverContent?.modelTurn?.parts || []).map((p) => p.text || "").join("");
  assert.equal(text, "Checking. It is 30 degrees. All done.");
  assert.ok(events.some((e) => e.serverContent?.userTurn?.parts?.[0]?.text === "weather in Pune?"));
  assert.equal(toolEvents, 1);

  const audio = events.flatMap((e) => e.serverContent?.modelTurn?.parts || []).filter((p) => p.inlineData);
  assert.ok(audio.length > 0, "audio emitted");
  for (const a of audio) assert.equal(Buffer.from(a.inlineData!.data, "base64").length % 2, 0, "PCM stays 16-bit aligned");
  assert.equal(Buffer.from(audio[0].inlineData!.data, "base64").toString("latin1").includes("RIFF"), false);

  const [first, second] = seen.chat;
  assert.equal(first.stream, true);
  assert.equal(first.model, "glm5.3-flash");
  assert.equal(first.tools.length, 2, "duplicate tool removed");
  assert.deepEqual(first.tools[1].function.parameters, { type: "object", properties: {} });
  assert.equal(first.messages[0].role, "system");
  assert.match(JSON.stringify(first.messages.at(-1).content), /data:image\/jpeg;base64,FRAME/);
  assert.equal(second.messages.at(-1).role, "tool");
  assert.equal(second.messages.at(-1).tool_call_id, "c1");
  assert.equal(second.messages.at(-2).tool_calls[0].function.arguments, '{"location":"Pune"}');
  const tts = seen.tts[0];
  assert.deepEqual(
    [tts.speaker, tts.model, tts.output_audio_codec, tts.speech_sample_rate, tts.language_code],
    ["priya", "bulbul:v3", "linear16", 24000, "en-IN"],
  );

  // Barge-in: partial speech stops the reply and cancels the audio request.
  slowTts = true;
  events.length = 0;
  sttSend({ event: "transcript.final", text: "tell me a story" });
  await wait(() => events.some((e) => e.serverContent?.modelTurn?.parts?.[0]?.inlineData), "speech started");
  sttSend({ event: "transcript.partial", text: "stop" });
  await wait(() => events.some((e) => e.serverContent?.interrupted), "interrupted event");
  await wait(() => seen.ttsAborted > 0, "TTS request aborted");
  assert.equal(events.some((e) => e.serverContent?.turnComplete), false);

  // Conversation continues with valid history after the interruption.
  slowTts = false;
  events.length = 0;
  sttSend({ event: "transcript.final", text: "what were you saying" });
  await wait(() => events.some((e) => e.serverContent?.turnComplete), "turn after barge-in");
  const roles = seen.chat.at(-1).messages.map((m: any) => m.role);
  assert.deepEqual(roles.slice(0, 2), ["system", "user"]);
  assert.equal(roles.at(-1), "user");
  const orphan = seen.chat.at(-1).messages.some((m: any, i: number, all: any[]) => m.tool_calls && all[i + 1]?.role !== "tool");
  assert.equal(orphan, false, "no tool call without its result");

  session.close();
  wss.close();
  server.closeAllConnections();
  server.close();
  console.log("PASS: fake-server session test (STT -> chat + tools -> TTS, screen frame, barge-in, history)");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
