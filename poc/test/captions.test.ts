import { describe, expect, it } from "vitest";
import { Captions } from "../src/live/captions.js";
import type { LiveToken } from "../src/transcribe/soniox-live.js";

const tok = (text: string, startMs: number): LiveToken => ({
  text, startMs, endMs: startMs + 200, speaker: null, receivedMs: startMs + 500, latencyMs: 300,
});

describe("Captions", () => {
  const run = (f: (c: Captions) => void) => {
    let out = "";
    const c = new Captions((s) => (out += s), 1500);
    f(c);
    return out;
  };

  it("מילים רצופות של אותו דובר נכתבות באותה שורה", () => {
    const out = run((c) => {
      c.write("client", [tok("שלום", 0)]);
      c.write("client", [tok(" עולם", 400)]);
    });
    expect(out).toBe("[00:00] לקוח: שלום עולם");
  });

  it("שורה חדשה בהחלפת דובר או בשקט ארוך", () => {
    const out = run((c) => {
      c.write("consultant", [tok("שאלה", 0)]);
      c.write("client", [tok("תשובה", 1000)]);
      c.write("client", [tok("עוד משפט", 9000)]);
    });
    expect(out).toBe("[00:00] יועץ: שאלה\n[00:01] לקוח: תשובה\n[00:09] לקוח: עוד משפט");
  });

  it("breakLine סוגר שורה פתוחה פעם אחת בלבד", () => {
    const out = run((c) => {
      c.write(null, [tok("טקסט", 0)]);
      c.breakLine();
      c.breakLine();
    });
    expect(out).toBe("[00:00] ?: טקסט\n");
  });
});
