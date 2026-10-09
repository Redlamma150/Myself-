// ניקוי תמלול מהזיות. לקוח מהמסמך "מדריך מערכת התמלול": מודלי תמלול ממציאים לפעמים טקסט
// בשקט או בהקלטה חלשה, בדרך כלל כחזרה על אותו משפט. כאן מזהים את זה ומסמנים, ולא מוחקים בשקט.
import { normalize } from "../core/compare.js";
import type { Segment, Transcript } from "./types.js";

/** אותו משפט כמה פעמים ברצף נחשב הזיה. ערך המסמך: 5. אצלנו 3, כי שיחה אמיתית כמעט לא חוזרת שלוש פעמים. */
export const MAX_IDENTICAL_RUN = 3;
/** אם יותר מ-85% מהשורות הן חזרה על שורה קודמת, כל התמלול חשוד ונזרק (ערך המסמך). */
export const REPETITION_REJECT_RATIO = 0.85;

const key = (s: Segment) => normalize(s.text).join(" ");

/** חלק השורות (בין 0 ל-1) שהן חזרה מדויקת על שורה קודמת */
export function repetitionRatio(segments: Segment[]): number {
  if (segments.length === 0) return 0;
  const seen = new Set<string>();
  let repeats = 0;
  for (const s of segments) {
    const k = key(s);
    if (seen.has(k)) repeats++;
    else seen.add(k);
  }
  return repeats / segments.length;
}

export interface CleanResult {
  segments: Segment[];
  warnings: string[];
  /** התמלול כולו חשוד ולא כדאי להשתמש בו */
  rejected: boolean;
}

export function cleanSegments(input: Segment[]): CleanResult {
  const warnings: string[] = [];
  const ratio = repetitionRatio(input);
  if (input.length >= 5 && ratio > REPETITION_REJECT_RATIO) {
    warnings.push(`${(ratio * 100).toFixed(0)}% מהשורות הן חזרות. כנראה הזיה, התמלול נדחה.`);
    return { segments: [], warnings, rejected: true };
  }

  const out: Segment[] = [];
  let run = 0;
  let removed = 0;
  for (const s of input) {
    const prev = out[out.length - 1];
    const same = prev !== undefined && key(prev) === key(s) && key(s) !== "";
    run = same ? run + 1 : 1;
    if (same && run >= MAX_IDENTICAL_RUN) {
      // מרחיבים את הזמן של השורה הראשונה במקום להוסיף עוד עותק
      prev.endMs = Math.max(prev.endMs, s.endMs);
      removed++;
      continue;
    }
    out.push({ ...s });
  }
  if (removed) warnings.push(`הוסרו ${removed} שורות שחזרו על עצמן ברצף (הזיה אפשרית).`);

  // מספור מחדש, כדי ש-seq יישאר רציף
  out.forEach((s, i) => (s.seq = i + 1));
  return { segments: out, warnings, rejected: false };
}

export function cleanTranscript(t: Transcript): { transcript: Transcript; rejected: boolean } {
  const r = cleanSegments(t.segments);
  return {
    rejected: r.rejected,
    transcript: { ...t, segments: r.segments, warnings: [...(t.warnings ?? []), ...r.warnings] },
  };
}
