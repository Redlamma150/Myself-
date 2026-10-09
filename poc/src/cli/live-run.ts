// החיבור בין Soniox ל-Claude, בזמן אמת: משדרים הקלטה בקצב אמיתי, והתמלול החי נכנס ללולאת החילוץ.
// כל N שניות (ברירת מחדל 45) מה שנאמר מאז הסבב הקודם נשלח ל-Claude, והתיק וההערכה מתעדכנים ומודפסים.
//
// אין "מחבר" מוכן בין Soniox ל-Claude. החיבור הוא הקוד הזה: Soniox מחזיר טקסט, Claude מקבל טקסט.
//
// שימוש (צריך SONIOX_API_KEY ו-ANTHROPIC_API_KEY ב-.env, והקלטה ב-PCM, ראו README):
//   npm run live -- recordings/call1.pcm --terms "StudioFlow" --rate 380
//   npm run live -- --client recordings/client.pcm --consultant recordings/consultant.pcm
import "./env.js";
import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { DEMO_CATALOG } from "../core/catalog.js";
import { type Dossier, emptyDossier, monthlyValue } from "../core/dossier.js";
import { estimate } from "../core/estimate.js";
import { range } from "../core/ltr.js";
import { type CallMetrics, type Effort, Extractor } from "../extract/claude.js";
import { LiveBuffer } from "../live/buffer.js";
import { cleanSegments } from "../transcribe/clean.js";
import { latencyStats, runLiveSession } from "../transcribe/soniox-live.js";
import type { Segment, Speaker } from "../transcribe/types.js";
import { fmtMs, writeJson, writeText } from "./io.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    client: { type: "string" },
    consultant: { type: "string" },
    terms: { type: "string", default: "" },
    window: { type: "string", default: "45" },
    rate: { type: "string", default: "380" },
    model: { type: "string" },
    effort: { type: "string" },
    "consultant-speaker": { type: "string" },
    out: { type: "string" },
  },
});

const two = values.client && values.consultant;
const single = positionals[0];
if (!two && !single) {
  console.error("שימוש: npm run live -- <קובץ.pcm> | --client <קובץ> --consultant <קובץ> [--window 45] [--rate 380]");
  process.exit(1);
}

const terms = values.terms.split(",").map((t) => t.trim()).filter(Boolean);
const windowMs = Number(values.window) * 1000;
const rate = Number(values.rate);
const name = two ? "live-two-streams" : basename(single!, extname(single!));
const outDir = values.out ?? join("out", name, "live-run");
const extractor = new Extractor(DEMO_CATALOG, values.model, values.effort as Effort | undefined);

const buffer = new LiveBuffer();
const allSegments: Segment[] = [];
const rounds: { atMs: number; segments: number; metrics: CallMetrics; ok: boolean; hours: [number, number]; price: [number, number] }[] = [];
let dossier: Dossier = emptyDossier();
let busy: Promise<void> | null = null;
let startedAt = 0;

const show = (d: Dossier) => {
  const e = estimate({
    catalog: DEMO_CATALOG,
    components: d.components.map((c) => ({ key: c.catalog_key, phase: c.phase })),
    hourlyRate: rate,
    clientMonthlyValue: monthlyValue(d),
  });
  return e;
};

/** סבב חילוץ אחד. אם סבב קודם עדיין רץ, מחכים לו ואז רצים על מה שהצטבר. */
async function tick(): Promise<void> {
  if (busy) return;
  const fresh = cleanSegments(buffer.takeNew(values["consultant-speaker"])).segments;
  if (fresh.length === 0) return;
  const context = allSegments.slice(-6);
  allSegments.push(...fresh);

  busy = (async () => {
    const at = Date.now() - startedAt;
    const prevWhispers = new Set(dossier.whispers.map((w) => w.key));
    const { dossier: next, metrics } = await extractor.extract(dossier, context, fresh);
    if (next) dossier = next;
    const e = show(dossier);
    rounds.push({ atMs: at, segments: fresh.length, metrics, ok: next !== null, hours: [...e.hours], price: [...e.price] });
    await writeJson(join(outDir, `dossier-v${String(rounds.length).padStart(2, "0")}.json`), dossier);

    console.log(`\n── ${fmtMs(at)} · ${fresh.length} שורות חדשות · Claude ${(metrics.latencyMs / 1000).toFixed(1)} שנ׳${next ? "" : ` ⚠ ${metrics.stopReason}, נשאר התיק הקודם`}`);
    for (const w of dossier.whispers.filter((x) => !prevWhispers.has(x.key))) console.log(`   לחישה [${w.kind}]: ${w.headline_he}`);
    if (e.lines.length) {
      console.log(`   רכיבים: ${e.lines.map((l) => l.nameHe).join(", ")}`);
      console.log(`   הערכה: ${range(e.hours[0], e.hours[1], "שעות")}, ${range(e.price[0], e.price[1], "₪")}, ${range(e.weeks[0], e.weeks[1], "שבועות")}`);
    }
  })()
    .catch((err) => console.error(`   ⚠ סבב נכשל, ממשיכים: ${(err as Error).message}`))
    .finally(() => (busy = null));
  await busy;
}

console.log(`▶ משדר ומריץ את Claude כל ${values.window} שניות. מודל: ${values.model ?? process.env.LIVESCOPE_MODEL ?? "claude-opus-5-5"}`);
startedAt = Date.now();
const timer = setInterval(() => void tick(), windowMs);

const feed = (forced?: Speaker) => (tokens: Parameters<LiveBuffer["push"]>[0]) => buffer.push(tokens, forced);

try {
  const results = two
    ? await Promise.all([
        runLiveSession({ audioPath: values.client!, terms, diarization: false, onFinalTokens: feed("client") }),
        runLiveSession({ audioPath: values.consultant!, terms, diarization: false, onFinalTokens: feed("consultant") }),
      ])
    : [await runLiveSession({ audioPath: single!, terms, diarization: true, onFinalTokens: feed() })];
  clearInterval(timer);
  if (busy) await busy;
  await tick(); // מה שנשאר אחרי הסבב האחרון

  const lat = results.map((r) => latencyStats(r));
  const cost = rounds.reduce((s, r) => s + (r.metrics.costUsd ?? 0), 0);
  const failed = rounds.filter((r) => !r.ok).length;
  const avgClaude = rounds.reduce((s, r) => s + r.metrics.latencyMs, 0) / (rounds.length || 1);
  const e = show(dossier);

  const md = [
    `# ריצה חיה: ${name}`,
    ``,
    `| מדד | ערך |`,
    `|---|---|`,
    `| סבבי Claude | ${rounds.length} (נכשלו: ${failed}) |`,
    `| השהיית תמלול (חציון) | ${lat.map((l) => (l.p50Ms === null ? "—" : `${(l.p50Ms / 1000).toFixed(2)} שנ׳`)).join(" / ")} |`,
    `| זמן תגובה של Claude (ממוצע) | ${(avgClaude / 1000).toFixed(1)} שנ׳ |`,
    `| מדיבור ועד מסך, משוער | ${((lat[0]?.p50Ms ?? 0) / 1000 + windowMs / 2000 + avgClaude / 1000).toFixed(0)} שנ׳ (יעד: פחות מ-60) |`,
    `| עלות Claude | $${cost.toFixed(2)} |`,
    ``,
    `## הערכה בסוף`,
    ``,
    `- רכיבים: ${e.lines.map((l) => l.nameHe).join(", ") || "—"}`,
    `- ${range(e.hours[0], e.hours[1], "שעות")}, ${range(e.price[0], e.price[1], "₪")}, ${range(e.weeks[0], e.weeks[1], "שבועות")}`,
  ].join("\n");
  await writeText(join(outDir, "report.md"), md + "\n");
  await writeJson(join(outDir, "transcript.json"), { provider: "soniox", model: "live", segments: allSegments });
  console.log(`\n${md}\n\nנשמר ב-${outDir}`);
} catch (err) {
  clearInterval(timer);
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
}
