// קריאה אחת ללולאת החילוץ: תיק נוכחי + שורות חדשות → תיק מעודכן, עם מדידת זמן ועלות.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { CatalogComponent } from "../core/catalog.js";
import { type Dossier, makeDossierSchema } from "../core/dossier.js";
import type { Segment } from "../transcribe/types.js";
import { systemPrompt, userMessage } from "./prompt.js";

// מחיר לכל מיליון טוקנים, דולר. cacheWrite = כתיבה למטמון של 5 דקות (1.25 × input).
// לעדכן אם המחירון משתנה.
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface CallMetrics {
  model: string;
  effort: Effort;
  latencyMs: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number | null;
  stopReason: string | null;
}

export function costUsd(model: string, u: { input: number; cacheRead: number; cacheWrite: number; output: number }): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return (u.input * p.input + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite + u.output * p.output) / 1_000_000;
}

export class Extractor {
  private client = new Anthropic();
  private schema;
  private system: string;

  constructor(
    catalog: readonly CatalogComponent[],
    private model = process.env.LIVESCOPE_MODEL ?? "claude-opus-5-5",
    private effort: Effort = (process.env.LIVESCOPE_EFFORT as Effort | undefined) ?? "low",
  ) {
    const keys = catalog.map((c) => c.key);
    if (keys.length === 0) throw new Error("קטלוג ריק");
    this.schema = makeDossierSchema(keys as [string, ...string[]]);
    this.system = systemPrompt(catalog);
  }

  private request(dossier: Dossier, context: Segment[], fresh: Segment[]) {
    return {
      model: this.model,
      max_tokens: 16000,
      system: [{ type: "text" as const, text: this.system, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: userMessage(dossier, context, fresh) }],
      output_config: { effort: this.effort, format: betaZodOutputFormat(this.schema) },
      // אם מסווג בטיחות דוחה בטעות, הבקשה רצה שוב בצד השרת על מודל חלופי
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    };
  }

  /** ספירת טוקנים לקלט בלבד, בלי עלות. לבדיקה לפני ריצה אמיתית. */
  async countInputTokens(dossier: Dossier, context: Segment[], fresh: Segment[]): Promise<number> {
    const r = this.request(dossier, context, fresh);
    const res = await this.client.messages.countTokens({
      model: r.model,
      system: r.system,
      messages: r.messages,
    });
    return res.input_tokens;
  }

  async extract(dossier: Dossier, context: Segment[], fresh: Segment[]): Promise<{ dossier: Dossier | null; metrics: CallMetrics }> {
    const t0 = Date.now();
    // create ולא parse: parse זורק כשהפלט נחתך, ואז מאבדים את נתוני העלות. כאן מאמתים בעצמנו.
    const res = await this.client.beta.messages.create(this.request(dossier, context, fresh));
    const latencyMs = Date.now() - t0;
    const u = res.usage;
    const usage = {
      input: u.input_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      output: u.output_tokens,
    };
    const metrics: CallMetrics = {
      model: this.model,
      effort: this.effort,
      latencyMs,
      inputTokens: usage.input,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      outputTokens: usage.output,
      costUsd: costUsd(this.model, usage),
      stopReason: res.stop_reason,
    };
    // סירוב, חיתוך או JSON לא תקין: לא קורסים. נשארים עם התיק הקודם, והסבב הבא ישלים.
    if (res.stop_reason !== "end_turn") return { dossier: null, metrics };
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { dossier: null, metrics: { ...metrics, stopReason: "invalid_json" } };
    }
    const parsed = this.schema.safeParse(json);
    if (!parsed.success) return { dossier: null, metrics: { ...metrics, stopReason: "schema_mismatch" } };
    return { dossier: parsed.data, metrics };
  }
}
