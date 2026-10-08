// השוואת תמלול לתמלול ייחוס (שתיקנתם ידנית).
// WER כללי, ובנוסף מה שבאמת חשוב לנו: מספרים, סכומים ושמות כלים.

/** נרמול לעברית: בלי ניקוד, בלי פיסוק, מספרים בלי פסיקים. */
export function normalize(text: string): string[] {
  return text
    .normalize("NFKC")
    .replace(/[֑-ׇ]/g, "") // ניקוד וטעמים
    .replace(/(\d),(?=\d{3})/g, "$1") // 4,000 → 4000
    .replace(/[₪$%]/g, " $& ")
    .replace(/[^\p{L}\p{N}₪$%\s]/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Word Error Rate: (החלפות + מחיקות + הוספות) / מספר המילים בייחוס */
export function wer(reference: string[], hypothesis: string[]): number {
  if (reference.length === 0) return hypothesis.length ? 1 : 0;
  let prev = Array.from({ length: hypothesis.length + 1 }, (_, j) => j);
  for (let i = 1; i <= reference.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hypothesis.length; j++) {
      const sub = prev[j - 1]! + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j]! + 1, cur[j - 1]! + 1);
    }
    prev = cur;
  }
  return prev[hypothesis.length]! / reference.length;
}

/** מספרים מהטקסט, כולל מספרים במילים נפוצות ("עשרה", "חצי") */
const HE_NUMBERS: Record<string, number> = {
  אחד: 1, אחת: 1, שניים: 2, שתיים: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5,
  שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10,
  עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50, מאה: 100, מאתיים: 200, אלף: 1000, אלפיים: 2000,
};

// צורת סמיכות לפני "אלפים": "ארבעת אלפים" = 4000
const HE_CONSTRUCT: Record<string, number> = {
  שלושת: 3, ארבעת: 4, חמשת: 5, ששת: 6, שבעת: 7, שמונת: 8, תשעת: 9, עשרת: 10,
};

function wordValue(tok: string): number | undefined {
  const bare = tok.replace(/^[ובלהשמכ]/, ""); // "ועשרה"
  return HE_NUMBERS[tok] ?? HE_NUMBERS[bare] ?? HE_CONSTRUCT[tok] ?? HE_CONSTRUCT[bare];
}

export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const toks = normalize(text);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!;
    const digits = tok.replace(/^[ובלהשמכ]{1,3}(?=\d)/, ""); // "ב300", "וב300"
    const next = toks[i + 1];
    if (/^\d+(\.\d+)?$/.test(digits)) {
      // "4 אלפים" / "10 אלף"
      if (next === "אלפים" || next === "אלף") { out.push(Number(digits) * 1000); i++; }
      else out.push(Number(digits));
      continue;
    }
    const v = wordValue(tok);
    if (v === undefined) continue;
    if ((next === "אלפים" || next === "אלף") && v < 1000) { out.push(v * 1000); i++; }
    else if (HE_CONSTRUCT[tok] === undefined) out.push(v);
  }
  return out;
}

/** מילים בלועזית (בדרך כלל שמות כלים ומוצרים) */
export function extractLatinTerms(text: string): string[] {
  return (text.match(/[A-Za-z][A-Za-z0-9.+-]*/g) ?? []).map((t) => t.toLowerCase());
}

export interface TermResult {
  term: string;
  inReference: number;
  inHypothesis: number;
}

function countMulti<T>(items: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

/** recall של מונחים: כמה מהמופעים בייחוס נמצאו גם בתמלול */
export function termRecall<T>(ref: T[], hyp: T[]): { recall: number; missing: { term: T; missed: number }[] } {
  const r = countMulti(ref);
  const h = countMulti(hyp);
  let total = 0, found = 0;
  const missing: { term: T; missed: number }[] = [];
  for (const [term, n] of r) {
    const got = Math.min(n, h.get(term) ?? 0);
    total += n;
    found += got;
    if (got < n) missing.push({ term, missed: n - got });
  }
  return { recall: total ? found / total : 1, missing };
}

/** מונחים שהמשתמש ביקש לבדוק במפורש (StudioFlow, וואטסאפ…), כולל מילים בעברית */
export function customTermRecall(refText: string, hypText: string, terms: string[]): TermResult[] {
  const count = (text: string, term: string) => {
    const n = normalize(text).join(" ");
    const t = normalize(term).join(" ");
    if (!t) return 0;
    return n.split(t).length - 1;
  };
  return terms.map((term) => ({ term, inReference: count(refText, term), inHypothesis: count(hypText, term) }));
}
