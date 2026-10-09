import { request, createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureServer } from "../src/capture/server.js";

const servers: Server[] = [];
afterEach(() => Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))));

const listen = (s: Server) => new Promise<number>((r) => { servers.push(s); s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)); });

/** Soniox מדומה: מנפיק מפתח זמני רק למי שמציג את המפתח הקבוע הנכון */
async function mockSoniox(received: { auth?: string; body?: any }) {
  return listen(createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      received.auth = req.headers.authorization;
      received.body = JSON.parse(b || "{}");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ api_key: "temp-abc" }));
    });
  }));
}

function call(port: number, path: string, opts: { method?: string; host?: string; origin?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: { host: opts.host ?? `localhost:${port}`, ...(opts.origin ? { origin: opts.origin } : {}) } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("שרת הלכידה", () => {
  it("מגיש את הדף והספרייה, ואת כתובת ה-WebSocket", async () => {
    const port = await listen(createCaptureServer({ wsUrl: "ws://example.test/x", apiKey: "k" }));
    const page = await call(port, "/");
    expect(page.status).toBe(200);
    expect(page.body).toContain("דף לכידה");
    expect((await call(port, "/lib.js")).body).toContain("export function buildLines");
    expect(JSON.parse((await call(port, "/api/config")).body)).toEqual({ wsUrl: "ws://example.test/x" });
    expect((await call(port, "/secret.txt")).status).toBe(404);
    expect((await call(port, "/../package.json")).status).toBe(404);
  });

  it("מנפיק מפתח זמני לפי הפרוטוקול של Soniox, והמפתח הקבוע לא חוזר ללקוח", async () => {
    const got: { auth?: string; body?: any } = {};
    const sonioxPort = await mockSoniox(got);
    const port = await listen(createCaptureServer({ apiHost: `http://127.0.0.1:${sonioxPort}`, apiKey: "PERMANENT" }));
    const r = await call(port, "/api/temp-key", { method: "POST" });
    expect(JSON.parse(r.body)).toEqual({ apiKey: "temp-abc" });
    expect(r.body).not.toContain("PERMANENT");
    expect(got.auth).toBe("Bearer PERMANENT");
    expect(got.body).toEqual({ usage_type: "transcribe_websocket", expires_in_seconds: 60 });
  });

  it("בלי מפתח קבוע: שגיאה ברורה", async () => {
    const saved = process.env.SONIOX_API_KEY;
    delete process.env.SONIOX_API_KEY;
    const port = await listen(createCaptureServer({}));
    const r = await call(port, "/api/temp-key", { method: "POST" });
    expect(r.status).toBe(500);
    expect(r.body).toContain("SONIOX_API_KEY");
    if (saved) process.env.SONIOX_API_KEY = saved;
  });

  it("חוסם פניות מדומיין או מאתר אחר", async () => {
    const port = await listen(createCaptureServer({ apiKey: "k" }));
    expect((await call(port, "/api/config", { host: "evil.example.com" })).status).toBe(403);
    expect((await call(port, "/api/temp-key", { method: "POST", origin: "https://evil.example.com" })).status).toBe(403);
    expect((await call(port, "/api/config", { origin: `http://localhost:${port}` })).status).toBe(200);
  });
});
