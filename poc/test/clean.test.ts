import { describe, expect, it, vi } from "vitest";
import { cleanSegments, repetitionRatio } from "../src/transcribe/clean.js";
import { HttpError, withRetry } from "../src/transcribe/retry.js";
import type { Segment } from "../src/transcribe/types.js";

const seg = (seq: number, text: string, t = seq * 1000): Segment => ({
  seq, rawSpeaker: "1", speaker: "client", text, startMs: t, endMs: t + 900,
});

describe("cleanSegments", () => {
  it("שיחה תקינה לא משתנה", () => {
    const r = cleanSegments([seg(1, "שלום"), seg(2, "מה שלומך"), seg(3, "תודה"), seg(4, "תודה רבה")]);
    expect(r.segments.length).toBe(4);
    expect(r.warnings).toEqual([]);
    expect(r.rejected).toBe(false);
  });

  it("אותו משפט שלוש פעמים ומעלה ברצף מצטמצם לשורה אחת עם הערה", () => {
    const r = cleanSegments([
      seg(1, "בערך 300 לידים"),
      seg(2, "תודה רבה על הצפייה"), seg(3, "תודה רבה על הצפייה!"), seg(4, "תודה רבה על הצפייה"), seg(5, "תודה רבה על הצפייה"),
      seg(6, "ומה אחרי זה"),
    ]);
    expect(r.segments.map((s) => s.text)).toEqual(["בערך 300 לידים", "תודה רבה על הצפייה", "תודה רבה על הצפייה!", "ומה אחרי זה"]);
    expect(r.segments.map((s) => s.seq)).toEqual([1, 2, 3, 4]);
    expect(r.warnings[0]).toContain("2 שורות");
  });

  it("חזרה פעמיים בלבד היא לגיטימית", () => {
    const r = cleanSegments([seg(1, "כן"), seg(2, "כן"), seg(3, "אוקיי")]);
    expect(r.segments.length).toBe(3);
  });

  it("יותר מ-85% חזרות: התמלול נדחה", () => {
    const segs = Array.from({ length: 20 }, (_, i) => seg(i + 1, i === 0 ? "שלום" : "תודה רבה"));
    expect(repetitionRatio(segs)).toBeGreaterThan(0.85);
    const r = cleanSegments(segs);
    expect(r.rejected).toBe(true);
    expect(r.segments).toEqual([]);
  });
});

describe("withRetry", () => {
  const noWait = { sleep: async () => {} };

  it("מנסה שוב על 429 ו-5xx עד שמצליח", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new HttpError(429, "slow down"))
      .mockRejectedValueOnce(new HttpError(503, "down"))
      .mockResolvedValue("ok");
    expect(await withRetry(fn, noWait)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("שגיאה קבועה (401) נכשלת מיד", async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError(401, "bad key"));
    await expect(withRetry(fn, noWait)).rejects.toThrow("bad key");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("אחרי מספר הניסיונות המקסימלי נכשלת", async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError(500, "boom"));
    await expect(withRetry(fn, { attempts: 3, ...noWait })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
