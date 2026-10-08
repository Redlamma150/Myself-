// סכמת "תיק האבחון": הפלט של Claude בכל סבב.
// מפתחות הקטלוג הם enum, כך שהמודל לא יכול להמציא רכיב.
import { z } from "zod";

export function makeDossierSchema(catalogKeys: readonly [string, ...string[]]) {
  const evidence = z.array(z.number().int()).describe("מספרי seq של שורות התמלול שמהן זה נלקח");
  return z.object({
    business: z.object({
      type_he: z.string(),
      branches: z.number().int().nullable(),
      summary_he: z.string(),
    }),
    pains: z.array(
      z.object({
        key: z.string().describe("מזהה יציב. להשתמש שוב במזהה קיים אם זה אותו כאב"),
        text_he: z.string(),
        severity: z.enum(["high", "med", "low"]),
        quantified_value: z.number().nullable(),
        quantified_unit_he: z.string().nullable(),
        evidence_seq: evidence,
        status: z.enum(["open", "resolved"]),
      }),
    ),
    goals: z.array(z.object({ key: z.string(), text_he: z.string(), evidence_seq: evidence })),
    tools_mentioned: z.array(
      z.object({ key: z.string(), name: z.string(), purpose_he: z.string(), evidence_seq: evidence }),
    ),
    constraints: z.array(z.object({ key: z.string(), text_he: z.string() })),
    budget_signals: z.array(
      z.object({
        key: z.string(),
        text_he: z.string(),
        monthly_value_ils: z.number().nullable().describe("רק אם הלקוח אמר סכום חודשי במפורש"),
      }),
    ),
    components: z.array(
      z.object({
        catalog_key: z.enum(catalogKeys),
        reason_he: z.string(),
        phase: z.union([z.literal(1), z.literal(2)]),
        evidence_seq: evidence,
      }),
    ),
    diagram: z.object({
      nodes: z.array(z.object({ key: z.string(), title_he: z.string(), sub_he: z.string().nullable() })),
      edges: z.array(z.object({ from: z.string(), to: z.string(), label_he: z.string().nullable() })),
    }),
    whispers: z.array(
      z.object({
        key: z.string(),
        kind: z.enum(["pain", "goal", "money", "ask"]),
        headline_he: z.string(),
        why_he: z.string(),
      }),
    ),
    missing_questions: z.array(z.object({ key: z.string(), question_he: z.string(), why_he: z.string() })),
  });
}

export type Dossier = z.infer<ReturnType<typeof makeDossierSchema>>;

export function emptyDossier(): Dossier {
  return {
    business: { type_he: "", branches: null, summary_he: "" },
    pains: [],
    goals: [],
    tools_mentioned: [],
    constraints: [],
    budget_signals: [],
    components: [],
    diagram: { nodes: [], edges: [] },
    whispers: [],
    missing_questions: [],
  };
}

/** השווי החודשי האחרון שהלקוח אמר, אם אמר */
export function monthlyValue(d: Dossier): number | null {
  for (let i = d.budget_signals.length - 1; i >= 0; i--) {
    const v = d.budget_signals[i]?.monthly_value_ils;
    if (v) return v;
  }
  return null;
}
