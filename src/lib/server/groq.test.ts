import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AIError, aiJSON } from "./groq";

const Schema = z.object({ answer: z.string() });
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const call = () => aiJSON({ tier: "smart", system: "s", user: "u", schema: Schema, name: "t" });

describe("aiJSON", () => {
  it("fails clearly without a key", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    await expect(call()).rejects.toMatchObject({ status: 503 });
  });

  it("falls back from json_schema to JSON mode on a 400", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      bodies.push(b);
      return b.response_format.type === "json_schema" ? new Response("bad", { status: 400 }) : ok('{"answer":"yes"}');
    }));
    await expect(call()).resolves.toEqual({ answer: "yes" });
    expect(bodies[1].response_format).toEqual({ type: "json_object" });
  });

  it("drops optional parameters when they are rejected", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      return "include_reasoning" in b ? new Response("unknown param", { status: 400 }) : ok('{"answer":"plain"}');
    }));
    await expect(call()).resolves.toEqual({ answer: "plain" });
  });

  it("moves to the next model on a rate limit and reports it when all are busy", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      models.push(JSON.parse(String(init.body)).model);
      return new Response("slow down", { status: 429 });
    }));
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(AIError);
    expect(err.status).toBe(429);
    expect(new Set(models).size).toBeGreaterThan(1);
  });

  it("rejects output that does not match the schema, then retries", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (n++ === 0 ? ok('{"wrong":1}') : ok('Here you go: {"answer":"fixed"}'))));
    await expect(call()).resolves.toEqual({ answer: "fixed" });
  });
});
