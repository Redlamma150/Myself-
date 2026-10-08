import { describe, expect, it } from "vitest";
import { toWindows } from "../src/core/windows.js";
import type { Segment } from "../src/transcribe/types.js";

const seg = (seq: number, startS: number, endS: number): Segment => ({
  seq, rawSpeaker: "1", speaker: "client", text: `שורה ${seq}`, startMs: startS * 1000, endMs: endS * 1000,
});

describe("toWindows", () => {
  const segs = [seg(1, 0, 10), seg(2, 12, 40), seg(3, 41, 50), seg(4, 60, 95), seg(5, 100, 104)];

  it("כל שורה נכנסת פעם אחת, לפי זמן הסיום שלה", () => {
    const w = toWindows(segs, 45_000);
    expect(w.map((x) => x.newSegments.map((s) => s.seq))).toEqual([[1, 2], [3], [4, 5]]);
    expect(w.flatMap((x) => x.newSegments).length).toBe(segs.length);
  });

  it("חלון ריק מדולג, והקשר מגיע מהשורות שלפני", () => {
    const w = toWindows(segs, 30_000);
    expect(w.map((x) => x.newSegments.map((s) => s.seq))).toEqual([[1], [2, 3], [4, 5]]);
    expect(w[2]!.contextSegments.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(w[2]!.atMs).toBe(104_000);
  });
});
