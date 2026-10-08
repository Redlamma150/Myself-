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
  lines: { key: string; nameHe: string; hours: Range; rate: number; phase: 1 | 2 }[];
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
      return {
        key: c.key,
        nameHe: c.nameHe,
        hours: hoursFor(c, s.variant),
        rate: s.hourlyRateOverride ?? rate,
        phase: s.phase ?? c.defaultPhase,
      };
    })
    .filter((l) => input.phase === undefined || l.phase === input.phase);

  let hMin = 0, hMax = 0, pMin = 0, pMax = 0;
  for (const l of lines) {
    hMin += l.hours[0];
    hMax += l.hours[1];
    pMin += l.hours[0] * l.rate;
    pMax += l.hours[1] * l.rate;
  }

  const value = input.clientMonthlyValue;
  const roiMonths = value && value > 0 && lines.length ? (pMin + pMax) / 2 / value : null;

  return {
    hours: [hMin, hMax],
    price: [pMin, pMax],
    weeks: lines.length ? [weeksFor(hMin), weeksFor(hMax)] : [0, 0],
    roiMonths,
    hourlyRate: rate,
    lines,
  };
}
