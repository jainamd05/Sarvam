/**
 * Runs the real ELYSIA server against a local fake Sarvam API and talks to it the way the
 * browser does (WebSocket /live). Proves index.ts is wired up; not a test of the real API.
 *
 *   npx tsx scripts/test-sarvam-integration.ts
 */
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";

const PORT = 3127;
let chatRequests: any[] = [];
let ttsRequests = 0;

const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    if (req.url === "/v2/chat/completions") {
      chatRequests.push(body);
      if (!body.stream) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ choices: [{ message: { content: '{"transactions":[]}' } }] }));
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const usedTool = body.messages.at(-1).role === "tool";
      const delta = usedTool
        ? { content: "Your reminder is set." }
        : { tool_calls: [{ index: 0, id: "c1", function: { name: "setReminder", arguments: '{"text":"tea","minutes":5}' } }] };
      res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      return res.end("data: [DONE]\n\n");
    }
    if (req.url === "/text-to-speech/stream") {
      ttsRequests++;
      res.writeHead(200, { "Content-Type": "audio/wav" });
      return res.end(Buffer.alloc(4800));
    }
    res.writeHead(404).end();
  });
});
const stt = new WebSocketServer({ server: fake, path: "/speech-to-text-realtime/ws" });
stt.on("connection", (ws) => {
  let sent = false;
  ws.on("message", (m) => {
    if (!sent && JSON.parse(m.toString()).event === "audio_input") {
      sent = true;
      ws.send(JSON.stringify({ event: "transcript.final", text: "remind me about tea" }));
    }
  });
});

const wait = async (cond: () => boolean, what: string, ms = 60000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`Timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

async function main() {
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elysia-test-"));
  let logs = "";
  const server = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      ELYSIA_DATA_DIR: dataDir,
      SARVAM_API_KEY: "fake-key",
      SARVAM_BASE_URL: `http://127.0.0.1:${(fake.address() as any).port}`,
    },
  });
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));

  try {
    let config: any = null;
    await wait(() => {
      fetch(`http://127.0.0.1:${PORT}/api/config`).then((r) => r.json()).then((j) => (config = j)).catch(() => {});
      return Boolean(config);
    }, "server start");
    assert.equal(config.hasApiKey, true);

    const events: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/live?voice=Charon&avatarStyle=orb`);
    ws.on("message", (m) => events.push(JSON.parse(m.toString())));
    await wait(() => events.some((e) => e.status === "connected"), "live session");
    ws.send(JSON.stringify({ audio: "AAAA" }));
    await wait(() => events.some((e) => e.type === "turnComplete"), "turn complete");

    const first = chatRequests.find((r) => r.stream);
    const toolNames = first.tools.map((t: any) => t.function.name);
    assert.ok(toolNames.length >= 90, `expected the full tool list, got ${toolNames.length}`);
    assert.equal(new Set(toolNames).size, toolNames.length);
    const types = JSON.stringify(first.tools).match(/"type":"[A-Z]+"/);
    assert.equal(types, null, "tool schemas use JSON Schema type names");
    assert.match(first.messages[0].content, /ELYSIA|AEGIS/);

    assert.ok(events.some((e) => e.type === "transcription" && e.role === "user" && e.text === "remind me about tea"));
    assert.ok(events.some((e) => e.type === "transcription" && e.role === "model" && /reminder is set/.test(e.text)));
    assert.ok(events.some((e) => e.type === "audio"), "audio reached the client");
    assert.ok(ttsRequests > 0);
    const toolResult = chatRequests.find((r) => r.stream && r.messages.at(-1).role === "tool");
    assert.match(toolResult.messages.at(-1).content, /Reminder set: \\"tea\\" in 5/);
    ws.close();
    console.log(`PASS: server -> fake Sarvam -> client (${toolNames.length} tools sent, reminder tool ran, audio delivered)`);
  } catch (e) {
    console.error(logs.slice(-2000));
    throw e;
  } finally {
    if (process.platform === "win32") {
      try { execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ }
    } else server.kill("SIGKILL");
    stt.close();
    fake.closeAllConnections();
    fake.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAIL:", e); process.exit(1); });
