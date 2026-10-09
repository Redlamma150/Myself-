// שרת מקומי קטן לדף הלכידה. תפקידיו:
//  1. להגיש את הדף.
//  2. להנפיק מפתח זמני ל-Soniox (60 שניות), כדי שהמפתח הקבוע לעולם לא יגיע לדפדפן. לפי שרת הדוגמה הרשמי שלהם.
// מאזין רק למחשב שלך (127.0.0.1), ולא לרשת.
import "../cli/env.js";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HttpError, withRetry } from "../transcribe/retry.js";

const PUBLIC_DIR = join(import.meta.dirname, "public");
const FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/lib.js": { file: "lib.js", type: "text/javascript; charset=utf-8" },
};

export interface CaptureServerOptions {
  port?: number;
  /** מקור ה-API של Soniox. משתנה רק בבדיקות. */
  apiHost?: string;
  /** כתובת ה-WebSocket שהדף יתחבר אליה. משתנה רק בבדיקות. */
  wsUrl?: string;
  apiKey?: string;
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

function send(res: ServerResponse, status: number, body: string | Buffer, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

async function issueTemporaryKey(apiHost: string, apiKey: string): Promise<string> {
  return withRetry(async () => {
    const r = await fetch(`${apiHost}/v1/auth/temporary-api-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ usage_type: "transcribe_websocket", expires_in_seconds: 60 }),
    });
    if (!r.ok) throw new HttpError(r.status, `Soniox temporary-api-key: HTTP ${r.status} ${await r.text()}`);
    const data = (await r.json()) as { api_key?: string };
    if (!data.api_key) throw new Error("תשובה לא צפויה מ-Soniox: אין api_key");
    return data.api_key;
  });
}

export function createCaptureServer(opts: CaptureServerOptions = {}) {
  const apiHost = opts.apiHost ?? process.env.SONIOX_API_HOST ?? "https://api.soniox.com";
  const wsUrl = opts.wsUrl ?? process.env.SONIOX_RT_URL ?? "wss://stt-rt.soniox.com/transcribe-websocket";

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // הגנה מפני אתרים אחרים שינסו לפנות לשרת המקומי (DNS rebinding / cross-origin)
      if (!LOCAL_HOST.test(req.headers.host ?? "")) return send(res, 403, JSON.stringify({ error: "forbidden host" }));
      const origin = req.headers.origin;
      if (origin && !LOCAL_HOST.test(new URL(origin).host)) return send(res, 403, JSON.stringify({ error: "forbidden origin" }));

      const path = new URL(req.url ?? "/", "http://localhost").pathname;

      if (req.method === "GET" && FILES[path]) {
        const f = FILES[path]!;
        return send(res, 200, await readFile(join(PUBLIC_DIR, f.file)), f.type);
      }
      if (req.method === "GET" && path === "/favicon.ico") return send(res, 204, "");
      if (req.method === "GET" && path === "/api/config") return send(res, 200, JSON.stringify({ wsUrl }));
      if (req.method === "POST" && path === "/api/temp-key") {
        const key = opts.apiKey ?? process.env.SONIOX_API_KEY;
        if (!key) return send(res, 500, JSON.stringify({ error: "חסר SONIOX_API_KEY בקובץ .env" }));
        return send(res, 200, JSON.stringify({ apiKey: await issueTemporaryKey(apiHost, key) }));
      }
      send(res, 404, JSON.stringify({ error: "not found" }));
    } catch (e) {
      send(res, 500, JSON.stringify({ error: (e as Error).message }));
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PORT ?? 5173);
  createCaptureServer({ port }).listen(port, "127.0.0.1", () => {
    console.log(`\nדף הלכידה פועל. פותחים בכרום את:\n\n  http://localhost:${port}\n\nלעצירה: Ctrl+C\n`);
    if (!process.env.SONIOX_API_KEY) console.warn("⚠ חסר SONIOX_API_KEY בקובץ .env, ולכן הדף לא יוכל להתחבר.");
  });
}
