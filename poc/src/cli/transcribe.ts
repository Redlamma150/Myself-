// שלב 2 בהוכחת ההיתכנות: אותו אודיו דרך Soniox ודרך Deepgram.
// שימוש:
//   npm run transcribe -- recordings/call1.mp3 --provider both --terms "StudioFlow,Meta,WhatsApp"
// פלט: out/<שם>/transcript.soniox.json, transcript.deepgram.json, וגרסת טקסט קריאה לכל אחד.
import "./env.js";
import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { transcribeDeepgram } from "../transcribe/deepgram.js";
import { transcribeSoniox } from "../transcribe/soniox.js";
import { cleanTranscript } from "../transcribe/clean.js";
import { assignSpeakers, type Transcript } from "../transcribe/types.js";
import { fmtMs, writeJson, writeText } from "./io.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    provider: { type: "string", default: "soniox" },
    terms: { type: "string", default: "" },
    "consultant-speaker": { type: "string" },
    out: { type: "string" },
  },
});

const audio = positionals[0];
if (!audio) {
  console.error("שימוש: npm run transcribe -- <קובץ אודיו> [--provider soniox|deepgram|both] [--terms a,b,c]");
  process.exit(1);
}
const name = basename(audio, extname(audio));
const outDir = values.out ?? join("out", name);
const terms = values.terms.split(",").map((t) => t.trim()).filter(Boolean);
const providers = values.provider === "both" ? ["soniox", "deepgram"] : [values.provider];

for (const p of providers) {
  console.log(`\n▶ ${p}: מתמלל ${audio}…`);
  try {
    const r =
      p === "soniox" ? await transcribeSoniox(audio, { terms })
      : p === "deepgram" ? await transcribeDeepgram(audio, { terms })
      : (() => { throw new Error(`ספק לא מוכר: ${p}`); })();
    const segments = assignSpeakers(r.segments, values["consultant-speaker"]);
    const t: Transcript = {
      provider: p as Transcript["provider"],
      model: r.model,
      audioFile: basename(audio),
      durationMs: segments.at(-1)?.endMs ?? 0,
      processingMs: r.processingMs,
      segments,
    };
    const { transcript: cleaned, rejected } = cleanTranscript(t);
    for (const w of cleaned.warnings ?? []) console.warn(`  ⚠ ${w}`);
    if (rejected) {
      await writeJson(join(outDir, `transcript.${p}.rejected.json`), cleaned);
      throw new Error("התמלול נדחה כחשוד בהזיה. לא נשמר כתמלול תקין.");
    }
    await writeJson(join(outDir, `transcript.${p}.json`), cleaned);
    await writeText(
      join(outDir, `transcript.${p}.txt`),
      cleaned.segments.map((s) => `[${fmtMs(s.startMs)}] ${s.speaker === "consultant" ? "יועץ" : s.speaker === "client" ? "לקוח" : "?"}: ${s.text}`).join("\n") + "\n",
    );
    console.log(`✓ ${cleaned.segments.length} שורות, ${(r.processingMs / 1000).toFixed(1)} שניות עיבוד → ${outDir}/transcript.${p}.json`);
  } catch (e) {
    console.error(`✗ ${p}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
console.log("\nבדקו בקובץ ה-txt שהיועץ והלקוח מזוהים נכון. אם הפוך: --consultant-speaker <מספר הדובר>.");
