import { describe, expect, it } from "vitest";
import { customTermRecall, extractLatinTerms, extractNumbers, normalize, termRecall, wer } from "../src/core/compare.js";

describe("normalize", () => {
  it("מסיר פיסוק וניקוד, ומאחד מספרים", () => {
    expect(normalize("בערך 4,000 שקל, כל חודש!")).toEqual(["בערך", "4000", "שקל", "כל", "חודש"]);
    expect(normalize("שָׁלוֹם")).toEqual(["שלום"]);
  });
});

describe("wer", () => {
  it("זהה = 0, החלפה אחת מתוך 4 = 0.25", () => {
    const ref = normalize("בערך 300 לידים בחודש");
    expect(wer(ref, ref)).toBe(0);
    expect(wer(ref, normalize("בערך 200 לידים בחודש"))).toBe(0.25);
    expect(wer(ref, normalize("בערך לידים בחודש"))).toBe(0.25);
  });
});

describe("מונחים", () => {
  it("מספרים בספרות ובמילים, כולל אות שימוש", () => {
    expect(extractNumbers("עוד עשרה אנשים, זה בערך 4,000 שקל וב300 לידים")).toEqual([10, 4000, 300]);
  });
  it("אלפים במילים ובספרות", () => {
    expect(extractNumbers("ארבעת אלפים שקל, או 4 אלפים, או עשרת אלפים")).toEqual([4000, 4000, 10000]);
  });
  it("שמות כלים בלועזית", () => {
    expect(extractLatinTerms("יש לנו StudioFlow ו-WhatsApp")).toEqual(["studioflow", "whatsapp"]);
  });
  it("recall עם מופעים חוזרים", () => {
    const r = termRecall([300, 10, 4000, 10], [300, 10, 400]);
    expect(r.recall).toBe(0.5);
    expect(r.missing).toEqual([{ term: 10, missed: 1 }, { term: 4000, missed: 1 }]);
  });
  it("מונח מותאם בעברית", () => {
    const [r] = customTermRecall("בוט וואטסאפ ועוד וואטסאפ", "בוט ווטסאפ ועוד וואטסאפ", ["וואטסאפ"]);
    expect(r).toEqual({ term: "וואטסאפ", inReference: 2, inHypothesis: 1 });
  });
});
