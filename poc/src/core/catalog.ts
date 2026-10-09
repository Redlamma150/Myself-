// קטלוג רכיבים. בשלב 1 הוא קובץ; בשלב 2 הוא עובר לטבלה catalog_components.
// השעות כאן הן מתסריט ההדגמה. את הקטלוג האמיתי (15 רכיבים) ממלאים מניסיון.

export type Range = readonly [min: number, max: number];

/** וריאנט לפי תוצאת בדיקה ברקע. ברירת המחדל היא תמיד "unknown", הטווח הזהיר. */
export type Variant = "unknown" | "verified_api" | "no_api";

export interface CatalogComponent {
  key: string;
  nameHe: string;
  /** נכנס ל-prompt: מתי הרכיב מתאים */
  whenToUseHe: string;
  hours: Range;
  /** רק לרכיבים שתלויים בבדיקה ברקע */
  variants?: Partial<Record<Variant, Range>>;
  defaultPhase: 1 | 2;
  category?: string;
  /** מחיר קבוע חד-פעמי בש"ח. אם קיים, הוא קובע את המחיר במקום שעות × תעריף. */
  fixedPrice?: number;
  /** ריטיינר חודשי בש"ח. מוצג בנפרד ולא נכלל במחיר החד-פעמי. שעות הרכיב הן שעות ההקמה. */
  monthlyPrice?: number;
  /** המחיר נקבע בהצעה ולא נכלל בסכום */
  quote?: boolean;
  /** נכלל בכל פרויקט שיש בו לפחות רכיב אחד נוסף (אפיון, בדיקות) */
  always?: boolean;
  /** השעות מדומות או נגזרות ולא נמדדו. משמשות רק לחישוב משך (ולרכיב בתמחור לפי שעות, גם למחיר). */
  hoursDerived?: boolean;
  /** הערה חופשית שנשלחת גם ל-Claude */
  note?: string;
}

export const DEMO_CATALOG: readonly CatalogComponent[] = [
  { key: "spec_trd", nameHe: "אפיון ו-TRD", whenToUseHe: "תמיד, בכל פרויקט", hours: [8, 10], defaultPhase: 1, always: true },
  { key: "lead_intake", nameHe: "קליטת לידים ממטא ל-CRM", whenToUseHe: "לידים מגיעים ממודעות או טפסים ומטופלים ידנית או באיחור", hours: [12, 18], defaultPhase: 1 },
  { key: "whatsapp_bot", nameHe: "בוט וואטסאפ: סינון ותיאום", whenToUseHe: "פניות בוואטסאפ, כולל מחוץ לשעות הפעילות, שצריך לענות עליהן ולתאם", hours: [26, 36], defaultPhase: 1 },
  { key: "trial_reminders", nameHe: "תזכורות לשיעור ניסיון", whenToUseHe: "אנשים נקבעים לפגישה או שיעור ולא מגיעים", hours: [8, 12], defaultPhase: 1 },
  { key: "owner_dashboard", nameHe: "דשבורד בעלים לפי סניף", whenToUseHe: "הבעלים לא יודע מה ההמרה או הביצועים לפי סניף או ערוץ", hours: [20, 28], defaultPhase: 2 },
  {
    key: "existing_system_integration",
    nameHe: "חיבור למערכת קיימת",
    whenToUseHe: "הלקוח עובד עם מערכת קיימת (מנויים, CRM, הנהלת חשבונות) שצריך לקרוא ממנה או לכתוב אליה",
    hours: [10, 24],
    variants: { unknown: [10, 24], verified_api: [10, 14] },
    defaultPhase: 1,
  },
  { key: "qa_rollout", nameHe: "בדיקות והטמעה", whenToUseHe: "תמיד, בסוף כל פרויקט", hours: [10, 12], defaultPhase: 1, always: true },
];

export function findComponent(catalog: readonly CatalogComponent[], key: string): CatalogComponent {
  const c = catalog.find((x) => x.key === key);
  if (!c) throw new Error(`רכיב לא קיים בקטלוג: ${key}`);
  return c;
}

/** הטווח לרכיב לפי הווריאנט. וריאנט שלא מוגדר נופל לטווח הבסיסי (הזהיר). */
export function hoursFor(c: CatalogComponent, variant: Variant = "unknown"): Range {
  return c.variants?.[variant] ?? c.hours;
}
