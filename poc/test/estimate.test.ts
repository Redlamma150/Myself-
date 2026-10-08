import { describe, expect, it } from "vitest";
import { DEMO_CATALOG } from "../src/core/catalog.js";
import { estimate, weeksFor, type SelectedComponent } from "../src/core/estimate.js";
import { ltr, range } from "../src/core/ltr.js";

// המצב בסוף תסריט ההדגמה (מיכל, 3 סטודיו פילאטיס)
const all = (variant: "unknown" | "verified_api"): SelectedComponent[] => [
  { key: "spec_trd" },
  { key: "lead_intake" },
  { key: "whatsapp_bot" },
  { key: "trial_reminders" },
  { key: "owner_dashboard" },
  { key: "existing_system_integration", variant },
  { key: "qa_rollout" },
];

describe("estimate: תסריט ההדגמה", () => {
  it("לפני בדיקת StudioFlow", () => {
    const e = estimate({ catalog: DEMO_CATALOG, components: all("unknown") });
    expect(e.hours).toEqual([94, 140]);
    expect(e.price).toEqual([35_720, 53_200]);
    expect(e.weeks).toEqual([6, 8]);
    expect(e.roiMonths).toBeNull();
  });

  it("אחרי הבדיקה, מול 4,000 ש\"ח בחודש", () => {
    const e = estimate({ catalog: DEMO_CATALOG, components: all("verified_api"), clientMonthlyValue: 4000 });
    expect(e.hours).toEqual([94, 130]);
    expect(e.price).toEqual([35_720, 49_400]);
    expect(e.weeks).toEqual([6, 7]);
    expect(e.roiMonths).toBeCloseTo(10.64, 2);
  });

  it("תעריף דינמי: שינוי תעריף לשיחה ותעריף שונה לרכיב", () => {
    const e = estimate({
      catalog: DEMO_CATALOG,
      hourlyRate: 400,
      components: [{ key: "spec_trd" }, { key: "whatsapp_bot", hourlyRateOverride: 450 }],
    });
    expect(e.hours).toEqual([34, 46]);
    expect(e.price).toEqual([8 * 400 + 26 * 450, 10 * 400 + 36 * 450]);
  });

  it("רק שלב 1 (בלי הדשבורד), ורכיב שהיועץ הסיר", () => {
    const comps = all("verified_api").map((c) => (c.key === "qa_rollout" ? { ...c, removed: true } : c));
    const e = estimate({ catalog: DEMO_CATALOG, components: comps, phase: 1 });
    expect(e.lines.map((l) => l.key)).not.toContain("owner_dashboard");
    expect(e.lines.map((l) => l.key)).not.toContain("qa_rollout");
    expect(e.hours).toEqual([64, 90]);
  });

  it("רכיב שלא בקטלוג נכשל במפורש", () => {
    expect(() => estimate({ catalog: DEMO_CATALOG, components: [{ key: "made_up" }] })).toThrow();
  });

  it("weeks = ceil(hours / 22) + 1", () => {
    expect(weeksFor(22)).toBe(2);
    expect(weeksFor(23)).toBe(3);
  });
});

describe("ltr", () => {
  it("עוטף טווח ב-LTR isolate", () => {
    expect(ltr("10–24")).toBe("⁦10–24⁩");
    expect(range(10, 24, "שעות")).toBe("⁦10–24⁩ שעות");
    expect(range(35720, 49400, "₪")).toBe("⁦₪35,720–49,400⁩");
  });
});
