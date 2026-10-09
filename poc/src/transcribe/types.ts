// פורמט תמלול אחיד, לא תלוי ספק. כל הסקריפטים האחרים קוראים רק אותו.

export type Speaker = "consultant" | "client" | "unknown";

export interface Segment {
  seq: number;
  /** הדובר כפי שהספק החזיר (מספר או תווית). המיפוי ליועץ/לקוח נעשה בנפרד. */
  rawSpeaker: string | null;
  speaker: Speaker;
  text: string;
  startMs: number;
  endMs: number;
}

export interface Transcript {
  provider: "soniox" | "deepgram" | "reference" | "fixture";
  model: string;
  audioFile: string | null;
  durationMs: number;
  /** זמן ריצה של הספק, מהשליחה ועד התוצאה */
  processingMs: number | null;
  segments: Segment[];
  /** הערות מניקוי התמלול (הזיות, חזרות) */
  warnings?: string[];
}

/**
 * ממפה דוברים גולמיים ל-יועץ/לקוח.
 * ברירת מחדל: הדובר הראשון שמדבר הוא היועץ (הוא פותח את השיחה).
 * אפשר לדרוס עם --consultant-speaker.
 */
export function assignSpeakers(segments: Omit<Segment, "speaker">[], consultantRaw?: string): Segment[] {
  const first = consultantRaw ?? segments.find((s) => s.rawSpeaker !== null)?.rawSpeaker ?? null;
  return segments.map((s) => ({
    ...s,
    speaker: s.rawSpeaker === null ? "unknown" : s.rawSpeaker === first ? "consultant" : "client",
  }));
}

/** מאחד מילים/טוקנים רצופים של אותו דובר לשורות. שורה נשברת בהחלפת דובר או בשקט ארוך. */
export function groupWords(
  words: { text: string; speaker: string | null; startMs: number; endMs: number }[],
  maxGapMs = 1500,
): Omit<Segment, "speaker">[] {
  const out: Omit<Segment, "speaker">[] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && last.rawSpeaker === w.speaker && w.startMs - last.endMs <= maxGapMs) {
      last.text += w.text;
      last.endMs = w.endMs;
    } else {
      out.push({ seq: out.length + 1, rawSpeaker: w.speaker, text: w.text, startMs: w.startMs, endMs: w.endMs });
    }
  }
  for (const s of out) s.text = s.text.replace(/\s+/g, " ").trim();
  return out;
}
