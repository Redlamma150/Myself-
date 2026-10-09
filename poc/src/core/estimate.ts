// לוגיקת ההערכה. קוד דטרמיניסטי בלבד: Claude בוחר רכיבים, כאן מחשבים מספרים.
import { type CatalogComponent, type Range, type Variant, findComponent, hoursFor } from "./catalog.js";

export const HOURS_PER_WEEK = 22;
export const DEFAULT_HOURLY_RATE = 380;

export interface SelectedComponent {
  key: string;
  variant?: Variant;
  phase?: 1 | 2;
  /** תעריף שונה לרכיב הזה בלבד (היועץ קובע) */
  hourlyRateOverride?: number;
  removed?: boolean;
}

export interface EstimateInput {
  catalog: readonly CatalogComponent[];
  components: readonly SelectedComponent[];
  hourlyRate?: number;
  /** כמה הלקוח אמר שזה שווה לו בחודש, בש"ח. בלי זה אין חישוב החזר. */
  clientMonthlyValue?: number | null;
  /** להציג רק שלב מסוים (למשל רק שלב 1) */
  phase?: 1 | 2;
}

export interface Estimate {
  hours: Range;
  price: Range;
  weeks: Range;
  /** חודשים עד החזר: אמצע טווח המחיר חלקי השווי החודשי */
  roiMonths: number | null;
  hourlyRate: number;
  /** סך הריטיינרים החודשיים, בנפרד מהמחיר החד-פעמי */
  monthly: number;
  /** רכיבים שהמחיר שלהם נקבע בהצעה, ולכן אינם בסכום */
  quoteItems: { key: string; nameHe: string }[];
  lines: {
    key: string; nameHe: string; hours: Range; rate: number; phase: 1 | 2;
    kind: "hourly" | "fixed" | "monthly" | "quote"; price: Range;
  }[];
}

export function weeksFor(hours: number): number {
  return Math.ceil(hours / HOURS_PER_WEEK) + 1;
}

export function estimate(input: EstimateInput): Estimate {
  const rate = input.hourlyRate ?? DEFAULT_HOURLY_RATE;
  const lines = input.components
    .filter((s) => !s.removed)
    .map((s) => {
      const c = findComponent(input.catalog, s.key);
      const rate0 = s.hourlyRateOverride ?? rate;
      const hours = hoursFor(c, s.variant);
      const kind: "hourly" | "fixed" | "monthly" | "quote" = c.quote ? "quote" : c.monthlyPrice !== undefined ? "monthly" : c.fixedPrice !== undefined ? "fixed" : "hourly";
      const price: Range =
        kind === "fixed" ? [c.fixedPrice!, c.fixedPrice!]
        : kind === "hourly" ? [hours[0] * rate0, hours[1] * rate0]
        : [0, 0];
      return { key: c.key, nameHe: c.nameHe, hours: kind === "quote" ? ([0, 0] as Range) : hours, rate: rate0, phase: s.phase ?? c.defaultPhase, kind, price, monthlyPrice: c.monthlyPrice ?? 0 };
    })
    .filter((l) => input.phase === undefined || l.phase === input.phase);

  let hMin = 0, hMax = 0, pMin = 0, pMax = 0, monthly = 0;
  for (const l of lines) {
    hMin += l.hours[0];
    hMax += l.hours[1];
    pMin += l.price[0];
    pMax += l.price[1];
    monthly += l.monthlyPrice;
  }
  const quoteItems = lines.filter((l) => l.kind === "quote").map((l) => ({ key: l.key, nameHe: l.nameHe }));

  const value = input.clientMonthlyValue;
  const roiMonths = value && value > 0 && pMax > 0 ? (pMin + pMax) / 2 / value : null;

  return {
    hours: [hMin, hMax],
    price: [pMin, pMax],
    weeks: hMax > 0 ? [weeksFor(hMin), weeksFor(hMax)] : [0, 0],
    roiMonths,
    hourlyRate: rate,
    monthly,
    quoteItems,
    lines: lines.map(({ monthlyPrice: _m, ...l }) => l),
  };
}
