// כתוביות חיות בטרמינל: מדפיסים את מה שמתקבל מ-Soniox תוך כדי, כדי שיהיה אפשר לראות מיד מה המערכת שמעה.
import type { LiveToken } from "../transcribe/soniox-live.js";
import { fmtMs } from "../cli/io.js";

const LABELS: Record<string, string> = { consultant: "יועץ", client: "לקוח" };

export class Captions {
  private lastLabel: string | null = null;
  private lastEndMs = 0;
  private open = false;

  constructor(private out: (s: string) => void = (s) => void process.stdout.write(s), private gapMs = 1500) {}

  /** label: "client", "consultant", או שם/מספר דובר מהספק. null = לא ידוע */
  write(label: string | null, tokens: LiveToken[]): void {
    if (tokens.length === 0) return;
    const first = tokens[0]!;
    const start = first.startMs ?? first.receivedMs;
    const lbl = label === null ? "?" : (LABELS[label] ?? `דובר ${label}`);
    if (!this.open || label !== this.lastLabel || start - this.lastEndMs > this.gapMs) {
      this.out(`${this.open ? "\n" : ""}[${fmtMs(start)}] ${lbl}: ${tokens.map((t) => t.text).join("").trimStart()}`);
    } else {
      this.out(tokens.map((t) => t.text).join(""));
    }
    this.open = true;
    this.lastLabel = label;
    this.lastEndMs = tokens.at(-1)!.endMs ?? tokens.at(-1)!.receivedMs;
  }

  /** סוגר שורה פתוחה, כדי שהדפסה אחרת לא תיכנס לאמצע משפט */
  breakLine(): void {
    if (this.open) this.out("\n");
    this.open = false;
  }
}
