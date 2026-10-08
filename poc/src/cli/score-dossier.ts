// שלב 3 בהוכחת ההיתכנות: האם Claude מצא את מה שהייתם כותבים בעצמכם?
// שימוש:
//   npm run score -- --golden fixtures/demo-golden.json out/…/dossier-v03.json
// golden: תיק שכתבתם ידנית לאותה שיחה (אותה סכמה; מספיק למלא components, pains, goals, tools_mentioned, budget_signals).
import "./env.js";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { type Dossier, monthlyValue } from "../core/dossier.js";
import { readJson, writeText } from "./io.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { golden: { type: "string" }, out: { type: "string" } },
});
const candidatePath = positionals[0];
if (!values.golden || !candidatePath) {
  console.error("שימוש: npm run score -- --golden <golden.json> <dossier.json>");
  process.exit(1);
}

const golden = await readJson<Partial<Dossier>>(values.golden);
const got = await readJson<Dossier>(candidatePath);

function setScore(expected: string[], actual: string[]) {
  const e = new Set(expected), a = new Set(actual);
  const hit = [...e].filter((x) => a.has(x));
  return {
    precision: a.size ? hit.length / a.size : 1,
    recall: e.size ? hit.length / e.size : 1,
    missing: [...e].filter((x) => !a.has(x)),
    extra: [...a].filter((x) => !e.has(x)),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

const comps = setScore((golden.components ?? []).map((c) => c.catalog_key), got.components.map((c) => c.catalog_key));
const phaseMismatch = (golden.components ?? [])
  .map((g) => ({ g, a: got.components.find((c) => c.catalog_key === g.catalog_key) }))
  .filter(({ g, a }) => a && a.phase !== g.phase)
  .map(({ g, a }) => `${g.catalog_key} (צפוי ${g.phase}, התקבל ${a!.phase})`);
const tools = setScore((golden.tools_mentioned ?? []).map((t) => norm(t.name)), got.tools_mentioned.map((t) => norm(t.name)));
const goldenValue = golden.budget_signals ? monthlyValue(golden as Dossier) : null;
const gotValue = monthlyValue(got);

const side = (title: string, g: { text_he: string }[] = [], a: { text_he: string }[] = []) => [
  ``,
  `### ${title}`,
  ``,
  `| ידני (${g.length}) | Claude (${a.length}) |`,
  `|---|---|`,
  ...Array.from({ length: Math.max(g.length, a.length) }, (_, i) => `| ${g[i]?.text_he ?? ""} | ${a[i]?.text_he ?? ""} |`),
];

const md = [
  `# ציון תיק אבחון`,
  ``,
  `ידני: \`${values.golden}\` מול Claude: \`${candidatePath}\``,
  ``,
  `| מדד | ערך |`,
  `|---|---|`,
  `| רכיבים: recall (מה שהיה צריך ונמצא) | ${pct(comps.recall)} |`,
  `| רכיבים: precision (מה שנבחר והיה נכון) | ${pct(comps.precision)} |`,
  `| כלים קיימים שזוהו | ${pct(tools.recall)} |`,
  `| שווי חודשי | ידני: ${goldenValue ?? "—"}, Claude: ${gotValue ?? "—"} ${goldenValue === gotValue ? "✓" : "✗"} |`,
  ``,
  comps.missing.length ? `- רכיבים חסרים: ${comps.missing.join(", ")}` : `- אין רכיבים חסרים.`,
  comps.extra.length ? `- רכיבים מיותרים: ${comps.extra.join(", ")}` : `- אין רכיבים מיותרים.`,
  phaseMismatch.length ? `- שלב שונה: ${phaseMismatch.join(", ")}` : `- השלבים תואמים.`,
  tools.missing.length ? `- כלים שלא זוהו: ${tools.missing.join(", ")}` : ``,
  ``,
  `## השוואה ידנית`,
  ``,
  `כאבים ומטרות נכתבים במילים שונות, אז את זה בודקים בעין: האם כל כאב שכתבתם מופיע אצל Claude, והאם יש אצלו משהו שהלקוח לא אמר?`,
  ...side("כאבים", golden.pains, got.pains),
  ...side("מטרות", golden.goals, got.goals),
  ``,
  `### לחישות של Claude`,
  ``,
  ...got.whispers.map((w) => `- **${w.kind}:** ${w.headline_he} _${w.why_he}_`),
  ``,
  `### שאלות חסרות לפי Claude`,
  ``,
  ...(got.missing_questions.length ? got.missing_questions.map((q) => `- ${q.question_he}`) : ["—"]),
].join("\n");

const outPath = values.out ?? join(dirname(candidatePath), "score.md");
await writeText(outPath, md + "\n");
console.log(md);
console.log(`\nנשמר: ${outPath}`);
