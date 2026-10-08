// שלב 2 בהוכחת ההיתכנות: כמה כל ספק טועה במה שחשוב.
// שימוש:
//   npm run compare -- --ref out/call1/reference.json out/call1/transcript.soniox.json out/call1/transcript.deepgram.json --terms "StudioFlow,וואטסאפ"
// reference.json: עותק של אחד התמלולים שתיקנתם ידנית (אותו פורמט). אפשר גם reference.txt: שורה לכל משפט.
import "./env.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { customTermRecall, extractLatinTerms, extractNumbers, normalize, termRecall, wer } from "../core/compare.js";
import type { Transcript } from "../transcribe/types.js";
import { readJson, writeText } from "./io.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { ref: { type: "string" }, terms: { type: "string", default: "" }, out: { type: "string" } },
});
if (!values.ref || positionals.length === 0) {
  console.error("שימוש: npm run compare -- --ref <ייחוס> <תמלול1.json> [<תמלול2.json> …] [--terms a,b]");
  process.exit(1);
}

async function loadText(path: string): Promise<{ label: string; text: string; t?: Transcript }> {
  if (path.endsWith(".txt")) return { label: "reference", text: await readFile(path, "utf8") };
  const t = await readJson<Transcript>(path);
  return { label: `${t.provider} (${t.model})`, text: t.segments.map((s) => s.text).join(" "), t };
}

/** כמה שורות שויכו לדובר הנכון, לפי זמן חופף עם הייחוס */
function speakerAccuracy(ref: Transcript, hyp: Transcript): number | null {
  let ok = 0, total = 0;
  for (const h of hyp.segments) {
    const mid = (h.startMs + h.endMs) / 2;
    const r = ref.segments.find((s) => s.startMs <= mid && mid <= s.endMs);
    if (!r || r.speaker === "unknown") continue;
    total++;
    if (r.speaker === h.speaker) ok++;
  }
  return total ? ok / total : null;
}

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const ref = await loadText(values.ref);
const terms = values.terms.split(",").map((t) => t.trim()).filter(Boolean);
const refWords = normalize(ref.text);

const lines: string[] = [
  `# השוואת תמלולים`,
  ``,
  `ייחוס: \`${values.ref}\` (${refWords.length} מילים)`,
  ``,
  `| ספק | WER | מספרים וסכומים | שמות בלועזית | דוברים | זמן עיבוד |`,
  `|---|---|---|---|---|---|`,
];
const details: string[] = [];

for (const path of positionals) {
  const hyp = await loadText(path);
  const w = wer(refWords, normalize(hyp.text));
  const nums = termRecall(extractNumbers(ref.text), extractNumbers(hyp.text));
  const latin = termRecall(extractLatinTerms(ref.text), extractLatinTerms(hyp.text));
  const spk = ref.t && hyp.t ? speakerAccuracy(ref.t, hyp.t) : null;
  const proc = hyp.t?.processingMs ? `${(hyp.t.processingMs / 1000).toFixed(0)} שנ׳` : "—";
  lines.push(`| ${hyp.label} | ${pct(w)} | ${pct(nums.recall)} | ${pct(latin.recall)} | ${pct(spk)} | ${proc} |`);

  details.push(``, `## ${hyp.label}`);
  if (nums.missing.length) details.push(`- מספרים שהתפספסו: ${nums.missing.map((m) => `${m.term}${m.missed > 1 ? ` ×${m.missed}` : ""}`).join(", ")}`);
  if (latin.missing.length) details.push(`- שמות שהתפספסו: ${latin.missing.map((m) => m.term).join(", ")}`);
  for (const r of customTermRecall(ref.text, hyp.text, terms)) {
    details.push(`- "${r.term}": ${r.inHypothesis}/${r.inReference}`);
  }
  if (!nums.missing.length && !latin.missing.length) details.push(`- לא התפספסו מספרים או שמות בלועזית.`);
}

lines.push(
  ``,
  `WER: אחוז שגיאות מילים (נמוך = טוב). מספרים ושמות: כמה מהמופעים בייחוס נתפסו (גבוה = טוב).`,
  `דוברים: אחוז השורות ששויכו נכון ליועץ או ללקוח (רק כשהייחוס הוא JSON עם זמנים).`,
  ...details,
);
const report = lines.join("\n") + "\n";
const outPath = values.out ?? join(dirname(values.ref), "compare-report.md");
await writeText(outPath, report);
console.log(report);
console.log(`נשמר: ${outPath}`);
