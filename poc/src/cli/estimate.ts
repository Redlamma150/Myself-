// הערכה מתוך תיק אבחון, עם תעריף משתנה. בלי Claude ובלי עלות.
// שימוש:
//   npm run estimate -- fixtures/demo-golden.json --rate 420 --phase 1 --verified
import { parseArgs } from "node:util";
import { DEMO_CATALOG } from "../core/catalog.js";
import { type Dossier, monthlyValue } from "../core/dossier.js";
import { estimate } from "../core/estimate.js";
import { readJson } from "./io.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rate: { type: "string", default: "380" },
    phase: { type: "string" },
    verified: { type: "boolean", default: false },
  },
});
if (!positionals[0]) {
  console.error("שימוש: npm run estimate -- <dossier.json> [--rate 380] [--phase 1] [--verified]");
  process.exit(1);
}
const d = await readJson<Dossier>(positionals[0]);
const e = estimate({
  catalog: DEMO_CATALOG,
  hourlyRate: Number(values.rate),
  phase: values.phase === "1" ? 1 : values.phase === "2" ? 2 : undefined,
  clientMonthlyValue: monthlyValue(d),
  components: d.components.map((c) => ({
    key: c.catalog_key,
    phase: c.phase,
    variant: c.catalog_key === "existing_system_integration" && values.verified ? "verified_api" : "unknown",
  })),
});
const ils = (n: number) => `₪${n.toLocaleString("en-US")}`;
for (const l of e.lines) console.log(`  ${l.nameHe.padEnd(28)} ${l.hours[0]}–${l.hours[1]} שעות  (שלב ${l.phase})`);
console.log(`\nתעריף: ${ils(e.hourlyRate)} לשעה`);
console.log(`שעות: ${e.hours[0]}–${e.hours[1]}`);
console.log(`מחיר: ${ils(e.price[0])}–${ils(e.price[1])}`);
console.log(`שבועות: ${e.weeks[0]}–${e.weeks[1]}`);
console.log(`החזר השקעה: ${e.roiMonths === null ? "—" : `${e.roiMonths.toFixed(1)} חודשים`}`);
