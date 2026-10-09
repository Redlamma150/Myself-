import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_CATALOG } from "../src/core/catalog.js";
import { loadCatalog, parseCatalog, resolveCatalog } from "../src/core/catalog-file.js";
import { estimate } from "../src/core/estimate.js";
import { systemPrompt } from "../src/extract/prompt.js";

const base = { key: "a", nameHe: "א", whenToUseHe: "כש-א", hours: [1, 2], defaultPhase: 1 };

describe("parseCatalog", () => {
  it("קטלוג תקין", () => expect(parseCatalog({ components: [base] })).toHaveLength(1));

  it("שגיאות ברורות", () => {
    expect(() => parseCatalog({ components: [] })).toThrow("לא תקין");
    expect(() => parseCatalog({ components: [{ ...base, key: "שלום" }] })).toThrow("מפתח באנגלית");
    expect(() => parseCatalog({ components: [{ ...base, hours: [5, 1] }] })).toThrow("מינימום גדול ממקסימום");
    expect(() => parseCatalog({ components: [base, base] })).toThrow('"a" מופיע יותר מפעם אחת');
    expect(() => parseCatalog({ components: [{ ...base, fixedPrice: 5, quote: true }] })).toThrow("כמה סוגי תמחור");
  });

  it("קובץ לא קיים, וברירת מחדל לקטלוג ההדגמה", async () => {
    await expect(loadCatalog("nope.json")).rejects.toThrow("לא נמצא קובץ קטלוג");
    delete process.env.LIVESCOPE_CATALOG;
    expect(await resolveCatalog()).toBe(DEMO_CATALOG);
  });
});

describe("הקטלוג המדומה של מאמני כושר", () => {
  const catalog = parseCatalog(JSON.parse(readFileSync("catalog/fitness-mock.json", "utf8")));

  it("נטען עם 14 רכיבים, והמחירים תואמים לקובץ המחירים", () => {
    expect(catalog).toHaveLength(14);
    const price = (k: string) => catalog.find((c) => c.key === k)!;
    expect(price("meals_by_portion").fixedPrice).toBe(1500);
    expect(price("register_api").fixedPrice).toBe(600);
    expect(price("whatsapp_alerts").monthlyPrice).toBe(150);
    expect(price("crm_automations").quote).toBe(true);
    expect(price("studio_system").quote).toBe(true);
  });

  it("הערכה: מחיר קבוע, ריטיינר חודשי והצעה נפרדים", () => {
    const e = estimate({
      catalog,
      hourlyRate: 999, // לא משפיע על מחיר קבוע
      components: ["meals_by_portion", "dynamic_forms", "refer_a_friend", "whatsapp_alerts", "crm_automations"].map((key) => ({ key })),
    });
    expect(e.price).toEqual([1500 + 1500 + 800, 1500 + 1500 + 800]);
    expect(e.monthly).toBe(150);
    expect(e.quoteItems.map((q) => q.key)).toEqual(["crm_automations"]);
    expect(e.lines.map((l) => l.kind)).toEqual(["fixed", "fixed", "fixed", "monthly", "quote"]);
    expect(e.weeks[0]).toBeGreaterThan(0);
  });

  it("הפרומפט מציג הערות וסוגי תמחור, ובלי כלל על רכיבי 'תמיד' כשאין כאלה", () => {
    const p = systemPrompt(catalog);
    expect(p).toContain("whatsapp_alerts");
    expect(p).toContain("monthly retainer");
    expect(p).toContain("priced by quote");
    expect(p).not.toContain("always included");
  });

  it("בקטלוג ההדגמה הכלל קיים", () => {
    expect(systemPrompt(DEMO_CATALOG)).toContain("always included");
  });
});
