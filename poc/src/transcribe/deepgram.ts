// תמלול קובץ ב-Deepgram (pre-recorded REST).
// לפני הריצה הראשונה: לוודא בתיעוד של Deepgram שהמודל (ברירת מחדל nova-3) תומך ב-he לקבצים מוקלטים,
// ואם לא, להגדיר DEEPGRAM_MODEL אחר ב-.env.
import { readFile } from "node:fs/promises";
import { HttpError, withRetry } from "./retry.js";
import { groupWords, type Segment } from "./types.js";

interface DgWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number;
}

export interface DeepgramOptions {
  model?: string;
  language?: string;
  /** מונחים חשובים (keyterm prompting) */
  terms?: string[];
}

export async function transcribeDeepgram(audioPath: string, opts: DeepgramOptions = {}) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("חסר DEEPGRAM_API_KEY ב-.env");
  const model = opts.model ?? process.env.DEEPGRAM_MODEL ?? "nova-3";
  const language = opts.language ?? process.env.DEEPGRAM_LANGUAGE ?? "he";

  const qs = new URLSearchParams({ model, language, diarize: "true", smart_format: "true", punctuate: "true" });
  for (const t of opts.terms ?? []) qs.append("keyterm", t);

  const t0 = Date.now();
  const audio = await readFile(audioPath);
  const json = await withRetry(async () => {
    const res = await fetch(`https://api.deepgram.com/v1/listen?${qs}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/octet-stream" },
      body: audio,
    });
    if (!res.ok) throw new HttpError(res.status, `Deepgram: HTTP ${res.status} ${await res.text()}`);
    return (await res.json()) as { results?: { channels?: { alternatives?: { words?: DgWord[] }[] }[] } };
  });
  const processingMs = Date.now() - t0;

  const dgWords = json.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  const words = dgWords.map((w) => ({
    text: " " + (w.punctuated_word ?? w.word),
    speaker: w.speaker === undefined ? null : String(w.speaker),
    startMs: Math.round(w.start * 1000),
    endMs: Math.round(w.end * 1000),
  }));
  const segments: Omit<Segment, "speaker">[] = groupWords(words);
  return { model: `${model}:${language}`, processingMs, segments };
}
