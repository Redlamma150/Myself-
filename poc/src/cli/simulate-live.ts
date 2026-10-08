// שלב 3+4 בהוכחת ההיתכנות: מריצים תמלול שלם דרך Claude כאילו הוא חי (כל 45 שניות),
// ומודדים איכות, זמן תגובה ועלות.
//
// שימוש:
//   npm run simulate -- fixtures/demo-transcript.json --dry-run      ספירת טוקנים בלבד, בלי עלות
//   npm run simulate -- out/call1/transcript.soniox.json             ריצה אמיתית (עולה כסף)
//   אופציות: --window 45  --model claude-sonnet-5-5  --effort low  --rate 380
import "./env.js";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { DEMO_CATALOG } from "../core/catalog.js";
import { type Dossier, emptyDossier, monthlyValue } from "../core/dossier.js";
import { estimate } from "../core/estimate.js";
import { toWindows } from "../core/windows.js";
import { type CallMetrics, type Effort, Extractor, costUsd } from "../extract/claude.js";
import type { Transcript } from "../transcribe/types.js";
import { fmtMs, readJson, writeJson, writeText } from "./io.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    window: { type: "string", default: "45" },
    model: { type: "string" },
    effort: { type: "string" },
    rate: { type: "string", default: "380" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const input = positionals[0];
if (!input) {
  console.error("שימוש: npm run simulate -- <transcript.json> [--dry-run] [--window 45] [--model …] [--effort low]");
  process.exit(1);
}

const transcript = await readJson<Transcript>(input);
const windowMs = Number(values.window) * 1000;
const rate = Number(values.rate);
const windows = toWindows(transcript.segments, windowMs);
const extractor = new Extractor(DEMO_CATALOG, values.model, values.effort as Effort | undefined);
const model = values.model ?? process.env.LIVESCOPE_MODEL ?? "claude-opus-5-5";
const outDir = values.out ?? join(dirname(input), "sim", `${basename(input, ".json")}.${model}.${values.effort ?? process.env.LIVESCOPE_EFFORT ?? "low"}`);

console.log(`${transcript.segments.length} שורות, ${fmtMs(transcript.durationMs)} דקות, ${windows.length} סבבים של ${values.window} שניות. מודל: ${model}`);

if (values["dry-run"]) {
  // התיק גדל לאורך השיחה; בספירה משתמשים בתיק ריק, ולכן זה גבול תחתון לקלט.
  let total = 0;
  for (const w of windows) total += await extractor.countInputTokens(emptyDossier(), w.contextSegments, w.newSegments);
  const outGuess = windows.length * 1500;
  const cost = costUsd(model, { input: total, cacheRead: 0, cacheWrite: 0, output: outGuess });
  console.log(`\nטוקני קלט (בלי התיק המצטבר): ${total.toLocaleString()}`);
  console.log(`הערכה גסה לפלט: ${outGuess.toLocaleString()} טוקנים (1,500 לסבב, כולל חשיבה; למדוד בריצה אמיתית)`);
  console.log(`עלות משוערת לשיחה: ${cost === null ? "—" : `$${cost.toFixed(2)}`} (גבול תחתון)`);
  process.exit(0);
}

interface Round {
  index: number;
  atMs: number;
  newSeq: number[];
  metrics: CallMetrics;
  ok: boolean;
  /** מפתחות שנעלמו מהתיק הקודם: מדד ליציבות (צריך להיות 0) */
  droppedKeys: string[];
  newWhispers: string[];
  components: string[];
  hours: [number, number];
  price: [number, number];
  roiMonths: number | null;
}

const keysOf = (d: Dossier) =>
  new Set([...d.pains, ...d.goals, ...d.tools_mentioned, ...d.whispers, ...d.diagram.nodes].map((x) => x.key));

let dossier = emptyDossier();
const rounds: Round[] = [];

for (const w of windows) {
  process.stdout.write(`סבב ${w.index + 1}/${windows.length} [${fmtMs(w.atMs)}] … `);
  const prevKeys = keysOf(dossier);
  const prevWhispers = new Set(dossier.whispers.map((x) => x.key));
  const { dossier: next, metrics } = await extractor.extract(dossier, w.contextSegments, w.newSegments);
  if (next) dossier = next;
  await writeJson(join(outDir, `dossier-v${String(w.index + 1).padStart(2, "0")}.json`), dossier);

  const est = estimate({
    catalog: DEMO_CATALOG,
    components: dossier.components.map((c) => ({ key: c.catalog_key, phase: c.phase })),
    hourlyRate: rate,
    clientMonthlyValue: monthlyValue(dossier),
  });
  const nowKeys = keysOf(dossier);
  rounds.push({
    index: w.index,
    atMs: w.atMs,
    newSeq: w.newSegments.map((s) => s.seq),
    metrics,
    ok: next !== null,
    droppedKeys: [...prevKeys].filter((k) => !nowKeys.has(k)),
    newWhispers: dossier.whispers.filter((x) => !prevWhispers.has(x.key)).map((x) => `${x.kind}: ${x.headline_he}`),
    components: dossier.components.map((c) => c.catalog_key),
    hours: [est.hours[0], est.hours[1]],
    price: [est.price[0], est.price[1]],
    roiMonths: est.roiMonths,
  });
  console.log(`${(metrics.latencyMs / 1000).toFixed(1)} שנ׳, ${metrics.outputTokens} טוקני פלט${next ? "" : ` ⚠ ${metrics.stopReason}`}`);
}

// --- סיכום ---
const lat = rounds.map((r) => r.metrics.latencyMs).sort((a, b) => a - b);
const p = (q: number) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] ?? 0;
const totalCost = rounds.reduce((s, r) => s + (r.metrics.costUsd ?? 0), 0);
const perHour = transcript.durationMs ? (totalCost / transcript.durationMs) * 3_600_000 : 0;
const avgLat = lat.reduce((a, b) => a + b, 0) / (lat.length || 1);
// שורה שנאמרה מחכה בממוצע חצי חלון עד הסבב, ואז עוד זמן התגובה של Claude
const speechToScreen = windowMs / 2 + avgLat;
const failed = rounds.filter((r) => !r.ok).length;
const dropped = rounds.reduce((s, r) => s + r.droppedKeys.length, 0);

const final = estimate({
  catalog: DEMO_CATALOG,
  components: dossier.components.map((c) => ({ key: c.catalog_key, phase: c.phase })),
  hourlyRate: rate,
  clientMonthlyValue: monthlyValue(dossier),
});

const md = [
  `# סימולציה חיה: ${basename(input)}`,
  ``,
  `מודל: \`${model}\`, מאמץ: \`${rounds[0]?.metrics.effort}\`, חלון: ${values.window} שניות, תעריף: ₪${rate}`,
  ``,
  `| מדד | ערך |`,
  `|---|---|`,
  `| סבבים | ${rounds.length} (נכשלו: ${failed}) |`,
  `| זמן תגובה של Claude: ממוצע / חציון / 90% | ${(avgLat / 1000).toFixed(1)} / ${(p(0.5) / 1000).toFixed(1)} / ${(p(0.9) / 1000).toFixed(1)} שנ׳ |`,
  `| מדיבור ועד עדכון מסך, ממוצע משוער | ${(speechToScreen / 1000).toFixed(0)} שנ׳ (יעד: פחות מ-60) |`,
  `| עלות Claude לשיחה | $${totalCost.toFixed(2)} |`,
  `| עלות Claude לשעת שיחה | $${perHour.toFixed(2)} |`,
  `| מפתחות שנעלמו בין סבבים | ${dropped} (צריך להיות 0) |`,
  `| טוקני מטמון שנקראו | ${rounds.reduce((s, r) => s + r.metrics.cacheReadTokens, 0).toLocaleString()} |`,
  ``,
  `## ההערכה בסוף`,
  ``,
  `- רכיבים: ${final.lines.map((l) => `${l.nameHe} (שלב ${l.phase})`).join(", ") || "—"}`,
  `- שעות: ${final.hours[0]}–${final.hours[1]}, מחיר: ₪${final.price[0].toLocaleString()}–${final.price[1].toLocaleString()}, שבועות: ${final.weeks[0]}–${final.weeks[1]}`,
  `- החזר השקעה: ${final.roiMonths === null ? "הלקוח לא אמר שווי חודשי" : `${final.roiMonths.toFixed(1)} חודשים`}`,
  ``,
  `## ציר זמן`,
  ``,
  `| זמן | שורות | שנ׳ | $ | לחישות חדשות | שעות |`,
  `|---|---|---|---|---|---|`,
  ...rounds.map(
    (r) =>
      `| ${fmtMs(r.atMs)} | ${r.newSeq[0]}–${r.newSeq.at(-1)} | ${(r.metrics.latencyMs / 1000).toFixed(1)} | ${(r.metrics.costUsd ?? 0).toFixed(3)} | ${r.newWhispers.join("<br>") || "—"}${r.ok ? "" : ` ⚠ ${r.metrics.stopReason}`}${r.droppedKeys.length ? `<br>נעלמו: ${r.droppedKeys.join(", ")}` : ""} | ${r.hours[0]}–${r.hours[1]} |`,
  ),
  ``,
  `התיק הסופי: \`dossier-v${String(rounds.length).padStart(2, "0")}.json\`. להשוואה מול התיק שכתבתם ידנית: \`npm run score\`.`,
].join("\n");

await writeJson(join(outDir, "rounds.json"), rounds);
await writeText(join(outDir, "report.md"), md + "\n");
console.log(`\n${md}\n\nנשמר ב-${outDir}`);
