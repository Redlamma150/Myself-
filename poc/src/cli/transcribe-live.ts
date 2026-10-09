// הוכחת היתכנות לתמלול חי: משדרים אודיו ל-Soniox בקצב אמיתי, כאילו זו שיחה, ומודדים השהיה.
//
// הכנת אודיו (פעם אחת, דורש ffmpeg):
//   ffmpeg -i recordings/call1.mp3 -ac 1 -ar 16000 -f s16le recordings/call1.pcm
// שימוש, זרם אחד עם זיהוי דוברים:
//   npm run transcribe:live -- recordings/call1.pcm --terms "StudioFlow,Meta"
// שימוש, שני זרמים נפרדים (מומלץ: לשונית הלקוח + מיקרופון היועץ, בלי ניחוש מי מדבר):
//   npm run transcribe:live -- --client recordings/client.pcm --consultant recordings/consultant.pcm
import "./env.js";
import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { cleanTranscript } from "../transcribe/clean.js";
import { type LiveResult, latencyStats, runLiveSession } from "../transcribe/soniox-live.js";
import { assignSpeakers, groupWords, type Segment, type Speaker, type Transcript } from "../transcribe/types.js";
import { fmtMs, writeJson, writeText } from "./io.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    client: { type: "string" },
    consultant: { type: "string" },
    terms: { type: "string", default: "" },
    format: { type: "string", default: "pcm_s16le" },
    "consultant-speaker": { type: "string" },
    out: { type: "string" },
  },
});

const terms = values.terms.split(",").map((t) => t.trim()).filter(Boolean);
const format = values.format as "pcm_s16le" | "auto";
const two = values.client && values.consultant;
const single = positionals[0];
if (!two && !single) {
  console.error("שימוש: npm run transcribe:live -- <קובץ.pcm> | --client <קובץ> --consultant <קובץ> [--terms a,b]");
  process.exit(1);
}
if (format === "auto") console.warn("⚠ פורמט auto: הקצב משוער, ולכן מדידת ההשהיה לא מדויקת. מומלץ pcm_s16le 16kHz מונו.");

const name = two ? "live-two-streams" : basename(single!, extname(single!));
const outDir = values.out ?? join("out", name);

function toSegments(r: LiveResult, forced?: Speaker): Segment[] {
  const words = r.tokens.map((t) => ({
    text: t.text,
    speaker: forced ? forced : t.speaker,
    startMs: t.startMs ?? t.receivedMs,
    endMs: t.endMs ?? t.receivedMs,
  }));
  const grouped = groupWords(words);
  if (forced) return grouped.map((s) => ({ ...s, speaker: forced }));
  return assignSpeakers(grouped, values["consultant-speaker"]);
}

console.log(two ? "▶ שני זרמים במקביל…" : `▶ ${single}: משדר בקצב אמיתי…`);
let segments: Segment[];
const stats: Record<string, ReturnType<typeof latencyStats> & { wallMs: number; audioMs: number }> = {};

try {
  if (two) {
    const [c, k] = await Promise.all([
      runLiveSession({ audioPath: values.client!, format, terms, diarization: false }),
      runLiveSession({ audioPath: values.consultant!, format, terms, diarization: false }),
    ]);
    stats.client = { ...latencyStats(c), wallMs: c.wallMs, audioMs: c.audioMs };
    stats.consultant = { ...latencyStats(k), wallMs: k.wallMs, audioMs: k.audioMs };
    segments = [...toSegments(c, "client"), ...toSegments(k, "consultant")]
      .sort((a, b) => a.startMs - b.startMs)
      .map((s, i) => ({ ...s, seq: i + 1 }));
  } else {
    const r = await runLiveSession({ audioPath: single!, format, terms, diarization: true });
    stats.single = { ...latencyStats(r), wallMs: r.wallMs, audioMs: r.audioMs };
    segments = toSegments(r);
  }
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
}

const transcript: Transcript = {
  provider: "soniox",
  model: `${process.env.SONIOX_RT_MODEL ?? "stt-rt-v5"} (live)`,
  audioFile: two ? `${basename(values.client!)} + ${basename(values.consultant!)}` : basename(single!),
  durationMs: segments.at(-1)?.endMs ?? 0,
  processingMs: Math.max(...Object.values(stats).map((s) => s.wallMs)),
  segments,
};
const { transcript: cleaned, rejected } = cleanTranscript(transcript);
for (const w of cleaned.warnings ?? []) console.warn(`  ⚠ ${w}`);
if (rejected) {
  await writeJson(join(outDir, "transcript.soniox-live.rejected.json"), cleaned);
  console.error("✗ התמלול נדחה כחשוד בהזיה.");
  process.exit(1);
}

await writeJson(join(outDir, "transcript.soniox-live.json"), cleaned);
await writeJson(join(outDir, "live-metrics.json"), stats);
await writeText(
  join(outDir, "transcript.soniox-live.txt"),
  cleaned.segments.map((s) => `[${fmtMs(s.startMs)}] ${s.speaker === "consultant" ? "יועץ" : s.speaker === "client" ? "לקוח" : "?"}: ${s.text}`).join("\n") + "\n",
);

const sec = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(2)} שנ׳`);
console.log(`\n✓ ${cleaned.segments.length} שורות → ${outDir}/transcript.soniox-live.json\n`);
console.log("השהיה בין הרגע שמילה נאמרה לרגע שהתקבלה (טוקנים סופיים):");
for (const [k, s] of Object.entries(stats)) {
  console.log(`  ${k}: חציון ${sec(s.p50Ms)}, 90% ${sec(s.p90Ms)}, מקסימום ${sec(s.maxMs)}, טוקן ראשון אחרי ${sec(s.timeToFirstTokenMs)} (${s.samples} טוקנים)`);
}
console.log("\nיעד: חציון של כמה שניות. לבדוק גם שהיועץ והלקוח מזוהים נכון בקובץ ה-txt.");
