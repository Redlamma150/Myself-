// טווחי מספרים בתוך טקסט עברי מתהפכים ("10–24" נראה "24–10").
// כל טווח עובר כאן, ונעטף ב-LTR isolate (U+2066 … U+2069).

const LRI = "⁦";
const PDI = "⁩";

export function ltr(text: string): string {
  return `${LRI}${text}${PDI}`;
}

const nf = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });

export function range(min: number, max: number, unit = ""): string {
  const body = min === max ? nf.format(min) : `${nf.format(min)}–${nf.format(max)}`;
  return unit === "₪" ? ltr(`₪${body}`) : ltr(body) + (unit ? ` ${unit}` : "");
}
