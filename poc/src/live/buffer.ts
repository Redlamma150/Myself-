// מצבר טוקנים חיים לשורות תמלול. כל קריאה ל-takeNew מחזירה רק את מה שנוסף מאז הפעם הקודמת,
// כדי שכל סבב חילוץ יקבל שורות חדשות בלבד, עם מספור רציף.
import type { LiveToken } from "../transcribe/soniox-live.js";
import { assignSpeakers, groupWords, type Segment, type Speaker } from "../transcribe/types.js";

interface Word {
  text: string;
  speaker: string | null;
  startMs: number;
  endMs: number;
  /** כשיש שני זרמים נפרדים, הדובר ידוע מראש */
  forced?: Speaker;
}

export class LiveBuffer {
  private pending: Word[] = [];
  private seq = 0;
  /** מי היועץ: הדובר הראשון שנשמע בכל השיחה, ולא בכל סבב. נקבע פעם אחת. */
  private consultantRaw: string | undefined;

  push(tokens: LiveToken[], forced?: Speaker): void {
    for (const t of tokens) {
      this.pending.push({
        text: t.text,
        speaker: forced ?? t.speaker,
        startMs: t.startMs ?? t.receivedMs,
        endMs: t.endMs ?? t.receivedMs,
        forced,
      });
    }
  }

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  takeNew(consultantRaw?: string): Segment[] {
    if (this.pending.length === 0) return [];
    const words = this.pending.sort((a, b) => a.startMs - b.startMs);
    this.pending = [];
    const grouped = groupWords(words).map((g) => ({ ...g, seq: ++this.seq }));
    const forcedBySpeaker = new Map(words.filter((w) => w.forced).map((w) => [w.speaker, w.forced!] as const));
    if (forcedBySpeaker.size) {
      return grouped.map((g) => ({ ...g, speaker: forcedBySpeaker.get(g.rawSpeaker) ?? "unknown" }));
    }
    this.consultantRaw = consultantRaw ?? this.consultantRaw ?? grouped.find((g) => g.rawSpeaker !== null)?.rawSpeaker ?? undefined;
    return assignSpeakers(grouped, this.consultantRaw);
  }
}
