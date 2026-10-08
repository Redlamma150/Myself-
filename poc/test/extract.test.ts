// בודק את הבקשה ל-Claude ואת פענוח התשובה, בלי רשת ובלי עלות (fetch מדומה).
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_CATALOG } from "../src/core/catalog.js";
import { emptyDossier } from "../src/core/dossier.js";
import { Extractor, costUsd } from "../src/extract/claude.js";
import type { Segment } from "../src/transcribe/types.js";

const fresh: Segment[] = [
  { seq: 1, rawSpeaker: "1", speaker: "client", text: "יש לנו StudioFlow לניהול המנויים", startMs: 0, endMs: 3000 },
];

function fakeResponse(dossierJson: unknown, stop = "end_turn") {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(dossierJson) }],
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Extractor", () => {
  it("שולח סכמה, מאמץ, fallback ו-cache, ומפענח את התשובה", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const answer = {
      ...emptyDossier(),
      tools_mentioned: [{ key: "studioflow", name: "StudioFlow", purpose_he: "מנויים", evidence_seq: [1] }],
      components: [{ catalog_key: "existing_system_integration", reason_he: "חיבור למנויים", phase: 1, evidence_seq: [1] }],
    };
    let body: any, headers: Headers | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      headers = new Headers(init.headers);
      return fakeResponse(answer);
    }));

    const ex = new Extractor(DEMO_CATALOG, "claude-opus-5-5", "low");
    const { dossier, metrics } = await ex.extract(emptyDossier(), [], fresh);

    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(headers?.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body.output_config.effort).toBe("low");
    expect(body.output_config.format.type).toBe("json_schema");
    const enumKeys = JSON.stringify(body.output_config.format.schema);
    for (const c of DEMO_CATALOG) expect(enumKeys).toContain(c.key);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[0].content).toContain("[1] לקוח: יש לנו StudioFlow");

    expect(dossier?.components[0]?.catalog_key).toBe("existing_system_integration");
    expect(metrics.costUsd).toBeCloseTo((1000 * 4 + 2000 * 0.2 + 500 * 20) / 1e6, 8);
  });

  it("תשובה שנחתכה לא מפילה: מחזיר null ושומר את סיבת העצירה", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ partial: true }, "max_tokens")));
    const ex = new Extractor(DEMO_CATALOG, "claude-opus-5-5", "low");
    const { dossier, metrics } = await ex.extract(emptyDossier(), [], fresh);
    expect(dossier).toBeNull();
    expect(metrics.stopReason).toBe("max_tokens");
  });

  it("מודל בלי מחירון מחזיר עלות null", () => {
    expect(costUsd("unknown-model", { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 })).toBeNull();
  });
});
