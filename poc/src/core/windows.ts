// מחלק תמלול לחלונות זמן, כמו שהמערכת החיה תקבל אותו: כל N שניות, מה שנאמר מאז הסבב הקודם.
import type { Segment } from "../transcribe/types.js";

export interface Window {
  index: number;
  /** הזמן בשיחה שבו הסבב יוצא */
  atMs: number;
  /** שורות שהסתיימו מאז הסבב הקודם */
  newSegments: Segment[];
  /** כמה שורות אחרונות מלפני, להקשר */
  contextSegments: Segment[];
}

export function toWindows(segments: Segment[], windowMs: number, contextCount = 6): Window[] {
  const out: Window[] = [];
  const end = segments.at(-1)?.endMs ?? 0;
  let consumed = 0;
  for (let at = windowMs, i = 0; consumed < segments.length; at += windowMs) {
    const last = at >= end;
    const fresh: Segment[] = [];
    while (consumed < segments.length && (last || segments[consumed]!.endMs <= at)) fresh.push(segments[consumed++]!);
    if (fresh.length === 0) continue;
    const firstNew = consumed - fresh.length;
    out.push({
      index: i++,
      atMs: last ? Math.max(end, at - windowMs) : at,
      newSegments: fresh,
      contextSegments: segments.slice(Math.max(0, firstNew - contextCount), firstNew),
    });
  }
  return out;
}
