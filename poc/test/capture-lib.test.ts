import { describe, expect, it } from "vitest";
import { buildLines, fmt, isMarker, labelLines, toText, toTranscript } from "../src/capture/public/lib.js";

const f = (text: string, startMs: number, speaker: string | null = null) => ({ text, startMs, endMs: startMs + 200, speaker });

describe("isMarker", () => {
  it("מזהה סימני שרת ולא דיבור", () => {
    expect(isMarker("<end>")).toBe(true);
    expect(isMarker(" <fin> ")).toBe(true);
    expect(isMarker("שלום")).toBe(false);
    expect(isMarker("a < b")).toBe(false);
  });
});

describe("שני זרמים נפרדים", () => {
  const streams = [
    { forced: "client" as const, offsetMs: 100, finals: [f("בערך 300", 3000), f(" לידים", 3300), f("ואנחנו", 12000)] },
    { forced: "consultant" as const, offsetMs: 0, finals: [f("כמה לידים", 0), f(" בחודש", 300)] },
  ];

  it("ממזג על ציר זמן אחד ומפריד לפי הזרם", () => {
    const lines = labelLines(buildLines(streams));
    expect(lines.map((l) => [l.speaker, l.text])).toEqual([
      ["consultant", "כמה לידים בחודש"],
      ["client", "בערך 300 לידים"],
      ["client", "ואנחנו"], // שקט ארוך פותח שורה חדשה
    ]);
    expect(lines[1]!.startMs).toBe(3100); // כולל ההיסט של הזרם
  });

  it("תמלול בפורמט של הסקריפטים", () => {
    const t = toTranscript(labelLines(buildLines(streams)));
    expect(t.provider).toBe("soniox");
    expect(t.segments.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(t.durationMs).toBe(t.segments.at(-1)!.endMs);
    expect(toText(labelLines(buildLines(streams)))).toContain("[00:03] לקוח: בערך 300 לידים");
  });
});

describe("מיקרופון יחיד עם זיהוי דוברים", () => {
  const streams = [{ forced: null, offsetMs: 0, finals: [f("שאלה", 0, "1"), f("תשובה", 2500, "2"), f("עוד שאלה", 6000, "1")] }];

  it("הדובר הראשון הוא היועץ", () => {
    expect(labelLines(buildLines(streams)).map((l) => l.speaker)).toEqual(["consultant", "client", "consultant"]);
  });

  it("אפשר להפוך אם הזיהוי יצא הפוך", () => {
    expect(labelLines(buildLines(streams), false).map((l) => l.speaker)).toEqual(["client", "consultant", "client"]);
  });
});

describe("fmt", () => {
  it("דקות ושניות", () => expect(fmt(125_000)).toBe("02:05"));
});
