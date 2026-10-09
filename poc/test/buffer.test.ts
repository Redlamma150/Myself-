import { describe, expect, it } from "vitest";
import { LiveBuffer } from "../src/live/buffer.js";
import type { LiveToken } from "../src/transcribe/soniox-live.js";

const tok = (text: string, startMs: number, speaker: string | null = null): LiveToken => ({
  text, startMs, endMs: startMs + 100, speaker, receivedMs: startMs + 200, latencyMs: 100,
});

describe("LiveBuffer", () => {
  it("מחזיר רק מה שנוסף, עם מספור רציף בין סבבים", () => {
    const b = new LiveBuffer();
    b.push([tok("שלום", 0, "0"), tok(" עולם", 200, "0")]);
    expect(b.takeNew().map((s) => [s.seq, s.text])).toEqual([[1, "שלום עולם"]]);
    expect(b.takeNew()).toEqual([]);
    b.push([tok("כן", 5000, "1")]);
    const second = b.takeNew();
    expect(second.map((s) => [s.seq, s.text, s.speaker])).toEqual([[2, "כן", "client"]]);
  });

  it("זיהוי דוברים: הראשון הוא היועץ, ואפשר לדרוס", () => {
    const b = new LiveBuffer();
    b.push([tok("שאלה", 0, "0"), tok("תשובה", 3000, "1")]);
    expect(b.takeNew().map((s) => s.speaker)).toEqual(["consultant", "client"]);
    b.push([tok("שאלה", 0, "0"), tok("תשובה", 3000, "1")]);
    expect(b.takeNew("1").map((s) => s.speaker)).toEqual(["client", "consultant"]);
  });

  it("שני זרמים נפרדים: ממוזגים לפי זמן, והדובר ידוע מהזרם", () => {
    const b = new LiveBuffer();
    b.push([tok("כמה לידים", 0), tok(" בחודש", 300)], "consultant");
    b.push([tok("בערך 300", 2500)], "client");
    b.push([tok("ואיך חוזרים", 6000)], "consultant");
    expect(b.takeNew().map((s) => [s.speaker, s.text])).toEqual([
      ["consultant", "כמה לידים בחודש"],
      ["client", "בערך 300"],
      ["consultant", "ואיך חוזרים"],
    ]);
  });
});
