// תמלול חי ב-Soniox (WebSocket). לפי הדוגמה הרשמית: speech_to_text/nodejs/soniox_realtime.js
// משדרים אודיו בקצב אמיתי, מקבלים טוקנים תוך כדי, ומודדים כמה זמן עובר מהרגע שמילה נאמרה ועד שהיא מתקבלת.
import { readFile } from "node:fs/promises";
import WebSocket from "ws";

export const SONIOX_WS_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
// pcm_s16le, 16kHz, מונו = 32,000 בתים בשנייה, כך ש-3,840 בתים הם בדיוק 120 מילישניות
export const PCM_CHUNK_BYTES = 3840;
export const PCM_CHUNK_MS = 120;

export interface LiveToken {
  text: string;
  startMs: number | null;
  endMs: number | null;
  speaker: string | null;
  /** כמה מילישניות אחרי תחילת השידור הטוקן הסופי התקבל */
  receivedMs: number;
  /** receivedMs פחות endMs: כמה אחרי שנאמר הוא הגיע. null אם אין זמן בטוקן. */
  latencyMs: number | null;
}

export interface LiveOptions {
  audioPath: string;
  /** pcm_s16le מאפשר מדידת השהיה מדויקת. auto מקבל כל פורמט, אבל הקצב משוער. */
  format?: "pcm_s16le" | "auto";
  terms?: string[];
  diarization?: boolean;
  model?: string;
  url?: string;
  apiKey?: string;
  /** שינוי רק לבדיקות: המתנה בין חתיכות */
  chunkMs?: number;
  /** כמה זמן מחכים לסיום אחרי שהאודיו נגמר */
  finishTimeoutMs?: number;
}

export interface LiveResult {
  tokens: LiveToken[];
  audioMs: number;
  wallMs: number;
  timeToFirstTokenMs: number | null;
}

interface RawToken {
  text?: string;
  start_ms?: number;
  end_ms?: number;
  speaker?: string | number;
  is_final?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runLiveSession(opts: LiveOptions): Promise<LiveResult> {
  const apiKey = opts.apiKey ?? process.env.SONIOX_API_KEY;
  if (!apiKey) throw new Error("חסר SONIOX_API_KEY ב-.env");
  const format = opts.format ?? "pcm_s16le";
  const chunkMs = opts.chunkMs ?? PCM_CHUNK_MS;
  const audio = await readFile(opts.audioPath);

  const config: Record<string, unknown> = {
    model: opts.model ?? process.env.SONIOX_RT_MODEL ?? "stt-rt-v5",
    language_hints: ["he", "en"],
    enable_speaker_diarization: opts.diarization ?? true,
    enable_endpoint_detection: true,
    ...(opts.terms?.length ? { context: { terms: opts.terms } } : {}),
    ...(format === "pcm_s16le" ? { audio_format: "pcm_s16le", sample_rate: 16000, num_channels: 1 } : { audio_format: "auto" }),
  };

  const ws = new WebSocket(opts.url ?? process.env.SONIOX_RT_URL ?? SONIOX_WS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
  const tokens: LiveToken[] = [];
  let t0 = 0;
  let firstTokenMs: number | null = null;

  return new Promise<LiveResult>((resolve, reject) => {
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* כבר סגור */ }
      if (err) return reject(err);
      resolve({
        tokens,
        audioMs: format === "pcm_s16le" ? Math.round((audio.length / 32000) * 1000) : 0,
        wallMs: Date.now() - t0,
        timeToFirstTokenMs: firstTokenMs,
      });
    };

    ws.on("error", (e) => done(e instanceof Error ? e : new Error(String(e))));
    ws.on("close", () => done(tokens.length ? undefined : new Error("החיבור נסגר לפני שהתקבל תמלול")));

    ws.on("message", (data) => {
      const res = JSON.parse(data.toString()) as { error_code?: number; error_message?: string; tokens?: RawToken[]; finished?: boolean };
      if (res.error_code) return done(new Error(`Soniox ${res.error_code}: ${res.error_message}`));
      const now = Date.now() - t0;
      for (const t of res.tokens ?? []) {
        if (!t.text || !t.is_final) continue; // טוקנים לא סופיים משתנים, ולכן לא שומרים אותם
        firstTokenMs ??= now;
        const endMs = t.end_ms ?? null;
        tokens.push({
          text: t.text,
          startMs: t.start_ms ?? null,
          endMs,
          speaker: t.speaker === undefined ? null : String(t.speaker),
          receivedMs: now,
          latencyMs: endMs === null ? null : now - endMs,
        });
      }
      if (res.finished) done();
    });

    ws.on("open", async () => {
      try {
        ws.send(JSON.stringify(config));
        t0 = Date.now();
        // שידור בקצב אמיתי לפי לוח זמנים מוחלט, כדי שהשהיות קטנות לא יצטברו.
        // חתיכה נשלחת רק אחרי שהאודיו שלה "נאמר", כמו במיקרופון אמיתי, אחרת ההשהיה נמדדת נמוכה מדי.
        for (let i = 0, n = 0; i < audio.length; i += PCM_CHUNK_BYTES, n++) {
          await sleep(Math.max(0, t0 + (n + 1) * chunkMs - Date.now()));
          if (settled) return;
          ws.send(audio.subarray(i, i + PCM_CHUNK_BYTES));
        }
        ws.send(""); // סימן סוף אודיו
        await sleep(opts.finishTimeoutMs ?? 30_000);
        done(new Error("לא התקבל סימן סיום מ-Soniox אחרי שהאודיו נגמר"));
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

export interface LatencyStats {
  samples: number;
  p50Ms: number | null;
  p90Ms: number | null;
  maxMs: number | null;
  timeToFirstTokenMs: number | null;
}

export function latencyStats(r: Pick<LiveResult, "tokens" | "timeToFirstTokenMs">): LatencyStats {
  const v = r.tokens.map((t) => t.latencyMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const q = (p: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))]! : null);
  return { samples: v.length, p50Ms: q(0.5), p90Ms: q(0.9), maxMs: v.at(-1) ?? null, timeToFirstTokenMs: r.timeToFirstTokenMs };
}
