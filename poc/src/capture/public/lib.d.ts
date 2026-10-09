export interface FinalToken { text: string; startMs?: number | null; endMs?: number | null; speaker?: string | null }
export interface StreamState { forced: "client" | "consultant" | null; offsetMs: number; finals: FinalToken[] }
export interface Line { key: string; text: string; startMs: number; endMs: number }
export interface LabeledLine extends Line { speaker: "consultant" | "client" | "unknown" }
export const GAP_MS: number;
export function isMarker(text: string): boolean;
export function fmt(ms: number): string;
export function buildLines(streams: StreamState[], gapMs?: number): Line[];
export function labelLines(lines: Line[], firstSpeakerIsConsultant?: boolean): LabeledLine[];
export function toTranscript(labeled: LabeledLine[], meta?: { model?: string }): {
  provider: "soniox"; model: string; audioFile: null; durationMs: number; processingMs: null;
  segments: { seq: number; rawSpeaker: string; speaker: string; text: string; startMs: number; endMs: number }[];
};
export function toText(labeled: LabeledLine[]): string;
