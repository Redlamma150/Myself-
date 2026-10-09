// טעינת קטלוג מקובץ JSON, עם בדיקת תקינות והודעות שגיאה ברורות.
// שימוש: --catalog catalog/fitness-mock.json, או LIVESCOPE_CATALOG ב-.env. בלי זה נשאר קטלוג ההדגמה.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { type CatalogComponent, DEMO_CATALOG } from "./catalog.js";

const range = z.tuple([z.number().nonnegative(), z.number().nonnegative()]).refine(([a, b]) => a <= b, "מינימום גדול ממקסימום");

const component = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "מפתח באנגלית קטנה, ספרות וקו תחתון בלבד"),
  nameHe: z.string().min(1),
  whenToUseHe: z.string().min(1),
  hours: range,
  variants: z.record(z.string(), range).optional(),
  defaultPhase: z.union([z.literal(1), z.literal(2)]),
  category: z.string().optional(),
  fixedPrice: z.number().nonnegative().optional(),
  monthlyPrice: z.number().nonnegative().optional(),
  quote: z.boolean().optional(),
  always: z.boolean().optional(),
  hoursDerived: z.boolean().optional(),
  note: z.string().optional(),
});

const file = z.object({ name: z.string().optional(), source: z.string().optional(), components: z.array(component).min(1) });

export function parseCatalog(json: unknown): CatalogComponent[] {
  const r = file.safeParse(json);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `  - ${i.path.join(".") || "(שורש)"}: ${i.message}`).join("\n");
    throw new Error(`קובץ הקטלוג לא תקין:\n${issues}`);
  }
  const keys = r.data.components.map((c) => c.key);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) throw new Error(`קובץ הקטלוג לא תקין: המפתח "${dup}" מופיע יותר מפעם אחת`);
  for (const c of r.data.components) {
    const modes = [c.fixedPrice !== undefined, c.monthlyPrice !== undefined, c.quote === true].filter(Boolean).length;
    if (modes > 1) throw new Error(`קובץ הקטלוג לא תקין: ברכיב "${c.key}" מוגדרים כמה סוגי תמחור (מחיר קבוע, ריטיינר, הצעה). צריך אחד.`);
  }
  return r.data.components as CatalogComponent[];
}

export async function loadCatalog(path: string): Promise<CatalogComponent[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`לא נמצא קובץ קטלוג: ${path}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`קובץ הקטלוג ${path} אינו JSON תקין: ${(e as Error).message}`);
  }
  return parseCatalog(json);
}

/** הקטלוג שנבחר: מהדגל, אחרת מהסביבה, אחרת קטלוג ההדגמה */
export async function resolveCatalog(cliValue?: string): Promise<readonly CatalogComponent[]> {
  const path = cliValue ?? process.env.LIVESCOPE_CATALOG;
  return path ? loadCatalog(path) : DEMO_CATALOG;
}
