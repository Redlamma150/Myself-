// לוגיקה טהורה של דף הלכידה: מאחדת טוקנים משני זרמים לשורות, ובונה תמלול בפורמט של הסקריפטים.
// כתוב ב-JavaScript רגיל כדי שהדפדפן יטען אותו ישירות, בלי שלב בנייה. הבדיקות ב-test/capture-lib.test.ts.

export const GAP_MS = 1500;

/** סימנים מיוחדים של השרת, כמו <end>. אינם חלק מהדיבור. */
export function isMarker(text) {
  return /^<[a-z_]+>$/i.test(String(text).trim());
}

export function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * streams: [{ forced: 'client' | 'consultant' | null, offsetMs, finals: [{text, startMs, endMs, speaker}] }]
 * מחזיר שורות ממוינות לפי זמן, כשכל שורה היא דובר אחד שמדבר ברצף.
 * offsetMs = הזמן שבו הזרם התחיל ביחס לתחילת השיחה, כדי ששני הזרמים ימוזגו על ציר זמן אחד.
 */
export function buildLines(streams, gapMs = GAP_MS) {
  const words = [];
  for (const s of streams) {
    for (const t of s.finals) {
      const start = (t.startMs ?? 0) + s.offsetMs;
      words.push({
        key: s.forced ?? `s${t.speaker ?? "?"}`,
        text: t.text,
        startMs: start,
        endMs: (t.endMs ?? t.startMs ?? 0) + s.offsetMs,
      });
    }
  }
  words.sort((a, b) => a.startMs - b.startMs);
  const lines = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && last.key === w.key && w.startMs - last.endMs <= gapMs) {
      last.text += w.text;
      last.endMs = w.endMs;
    } else {
      lines.push({ key: w.key, text: w.text, startMs: w.startMs, endMs: w.endMs });
    }
  }
  for (const l of lines) l.text = l.text.replace(/\s+/g, " ").trim();
  return lines.filter((l) => l.text !== "");
}

/**
 * מתייג שורות כ-consultant/client. בזרמים נפרדים התווית כבר ידועה.
 * במצב מיקרופון יחיד עם זיהוי דוברים: הדובר הראשון שמדבר הוא היועץ, וכל השאר לקוח.
 * firstSpeakerIsConsultant=false הופך את זה, למקרה שהזיהוי יצא הפוך.
 */
export function labelLines(lines, firstSpeakerIsConsultant = true) {
  const first = lines.find((l) => l.key.startsWith("s"))?.key;
  return lines.map((l) => {
    if (l.key === "consultant" || l.key === "client") return { ...l, speaker: l.key };
    const isFirst = l.key === first;
    return { ...l, speaker: l.key === "s?" ? "unknown" : isFirst === firstSpeakerIsConsultant ? "consultant" : "client" };
  });
}

/** בונה אובייקט תמלול באותו פורמט שהסקריפטים (simulate, score, live) קוראים. */
export function toTranscript(labeled, meta = {}) {
  const segments = labeled.map((l, i) => ({
    seq: i + 1,
    rawSpeaker: l.key,
    speaker: l.speaker,
    text: l.text,
    startMs: Math.round(l.startMs),
    endMs: Math.round(l.endMs),
  }));
  return {
    provider: "soniox",
    model: meta.model ?? "stt-rt-v5 (browser)",
    audioFile: null,
    durationMs: segments.length ? segments[segments.length - 1].endMs : 0,
    processingMs: null,
    segments,
  };
}

export function toText(labeled) {
  const name = { consultant: "יועץ", client: "לקוח", unknown: "?" };
  return labeled.map((l) => `[${fmt(l.startMs)}] ${name[l.speaker]}: ${l.text}`).join("\n") + "\n";
}
