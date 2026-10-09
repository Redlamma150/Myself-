// בודק את לקוח התמלול החי מול שרת WebSocket מדומה: בלי רשת ובלי עלות.
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { PCM_CHUNK_BYTES, latencyStats, runLiveSession } from "../src/transcribe/soniox-live.js";

let server: WebSocketServer | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

function audioFile(chunks: number): string {
  const p = join(mkdtempSync(join(tmpdir(), "ls-")), "a.pcm");
  writeFileSync(p, Buffer.alloc(chunks * PCM_CHUNK_BYTES));
  return p;
}

/** שרת מדומה: אחרי חתיכת האודיו השנייה שולח טוקן לא סופי וסופי, ובסיום האודיו שולח finished */
function mockServer(onConfig?: (c: any, headers: any) => void, failWith?: { code: number; msg: string }) {
  server = new WebSocketServer({ port: 0 });
  server.on("connection", (ws, req) => {
    let got = 0;
    ws.on("message", (data, isBinary) => {
      if (!isBinary && data.toString() !== "") return onConfig?.(JSON.parse(data.toString()), req.headers);
      if (!isBinary || data.toString() === "") {
        ws.send(JSON.stringify({ tokens: [], finished: true }));
        return;
      }
      got++;
      if (failWith && got === 1) return ws.send(JSON.stringify({ error_code: failWith.code, error_message: failWith.msg }));
      if (got === 2) {
        ws.send(JSON.stringify({ tokens: [{ text: " שלו", is_final: false, start_ms: 0, end_ms: 100 }] }));
        ws.send(JSON.stringify({ tokens: [
          { text: "שלום", is_final: true, start_ms: 0, end_ms: 120, speaker: "1" },
          { text: " עולם", is_final: true, start_ms: 130, end_ms: 240, speaker: "1" },
        ] }));
      }
    });
  });
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("runLiveSession", () => {
  it("שולח הגדרות נכונות, אוסף רק טוקנים סופיים, ומחשב השהיה", async () => {
    let cfg: any, headers: any;
    const url = mockServer((c, h) => ((cfg = c), (headers = h)));
    const r = await runLiveSession({ audioPath: audioFile(4), url, apiKey: "k", terms: ["StudioFlow"], chunkMs: 5 });

    expect(headers.authorization).toBe("Bearer k");
    expect(cfg.model).toBe("stt-rt-v5");
    expect(cfg.language_hints).toEqual(["he", "en"]);
    expect(cfg.audio_format).toBe("pcm_s16le");
    expect(cfg.sample_rate).toBe(16000);
    expect(cfg.context.terms).toEqual(["StudioFlow"]);

    expect(r.tokens.map((t) => t.text)).toEqual(["שלום", " עולם"]); // הלא סופי לא נשמר
    expect(r.tokens[0]?.speaker).toBe("1");
    expect(r.timeToFirstTokenMs).not.toBeNull();
    expect(r.audioMs).toBe(480); // 4 חתיכות × 120 מילישניות
    const s = latencyStats(r);
    expect(s.samples).toBe(2);
    expect(s.p50Ms).not.toBeNull();
  });

  it("שגיאה מהשרת נכשלת עם ההודעה שלו", async () => {
    const url = mockServer(undefined, { code: 401, msg: "bad key" });
    await expect(runLiveSession({ audioPath: audioFile(3), url, apiKey: "k", chunkMs: 5 })).rejects.toThrow("401: bad key");
  });

  it("בלי מפתח נכשל מיד", async () => {
    const saved = process.env.SONIOX_API_KEY;
    delete process.env.SONIOX_API_KEY;
    await expect(runLiveSession({ audioPath: "x" })).rejects.toThrow("SONIOX_API_KEY");
    if (saved) process.env.SONIOX_API_KEY = saved;
  });
});

describe("latencyStats", () => {
  it("אחוזונים, ומדלג על טוקנים בלי זמן", () => {
    const tok = (l: number | null) => ({ text: "x", startMs: 0, endMs: 0, speaker: null, receivedMs: 0, latencyMs: l });
    const s = latencyStats({ tokens: [tok(100), tok(300), tok(200), tok(null), tok(1000)], timeToFirstTokenMs: 900 });
    expect(s).toEqual({ samples: 4, p50Ms: 300, p90Ms: 1000, maxMs: 1000, timeToFirstTokenMs: 900 });
  });
});
