// תמלול קובץ ב-Soniox (async REST). לפי הדוגמה הרשמית: github.com/soniox/soniox_examples
// מעלים קובץ, יוצרים תמלול, ממתינים, מושכים טוקנים, ומוחקים את הקובץ והתמלול אצל Soniox.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { groupWords, type Segment } from "./types.js";

const BASE = "https://api.soniox.com";

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.SONIOX_API_KEY;
  if (!key) throw new Error("חסר SONIOX_API_KEY ב-.env");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Soniox ${init.method ?? "GET"} ${path}: HTTP ${res.status} ${await res.text()}`);
  return (init.method === "DELETE" ? null : await res.json()) as T;
}

interface SonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  speaker?: string | number;
}

export interface SonioxOptions {
  model?: string;
  /** מונחים שחשוב לזהות נכון: שמות כלים, שמות עסקים */
  terms?: string[];
  diarization?: boolean;
}

export async function transcribeSoniox(audioPath: string, opts: SonioxOptions = {}) {
  const model = opts.model ?? process.env.SONIOX_MODEL ?? "stt-async-v5";
  const form = new FormData();
  form.append("file", new Blob([await readFile(audioPath)]), basename(audioPath));

  const t0 = Date.now();
  const file = await api<{ id: string }>("/v1/files", { method: "POST", body: form });
  let transcriptionId: string | null = null;
  try {
    const tr = await api<{ id: string }>("/v1/transcriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        file_id: file.id,
        language_hints: ["he", "en"],
        enable_speaker_diarization: opts.diarization ?? true,
        ...(opts.terms?.length ? { context: { terms: opts.terms } } : {}),
      }),
    });
    transcriptionId = tr.id;

    for (;;) {
      const s = await api<{ status: string; error_message?: string }>(`/v1/transcriptions/${tr.id}`);
      if (s.status === "completed") break;
      if (s.status === "error") throw new Error(`Soniox: ${s.error_message}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    const result = await api<{ tokens: SonioxToken[] }>(`/v1/transcriptions/${tr.id}/transcript`);
    const processingMs = Date.now() - t0;

    const words = result.tokens.map((t) => ({
      text: t.text,
      speaker: t.speaker === undefined ? null : String(t.speaker),
      startMs: t.start_ms ?? 0,
      endMs: t.end_ms ?? t.start_ms ?? 0,
    }));
    const segments: Omit<Segment, "speaker">[] = groupWords(words);
    return { model, processingMs, segments };
  } finally {
    // פרטיות: לא משאירים את האודיו או התמלול אצל הספק
    if (transcriptionId) await api(`/v1/transcriptions/${transcriptionId}`, { method: "DELETE" }).catch(() => {});
    await api(`/v1/files/${file.id}`, { method: "DELETE" }).catch(() => {});
  }
}
