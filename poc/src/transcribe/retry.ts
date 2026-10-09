// ניסיון חוזר לקריאות לספקי תמלול: שגיאות זמניות (429, 5xx, נפילת רשת) מנסים שוב עם המתנה גדלה.
// שגיאות קבועות (מפתח שגוי, בקשה לא תקינה) נכשלות מיד.

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const isTransient = (e: unknown): boolean =>
  e instanceof HttpError ? e.status === 429 || e.status >= 500 : e instanceof TypeError; // TypeError = fetch נכשל ברשת

export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 4, baseMs = 1000, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransient(e) || i === attempts - 1) throw e;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}
