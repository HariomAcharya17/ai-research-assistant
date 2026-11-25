import "server-only";
import { z } from "zod";

// Groq's free tier: fast open-weight models through an OpenAI-compatible API.
// Groq retires models from time to time, so each tier lists fallbacks.
// A 429 on one model also falls through to the next, since limits are per model.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const TIERS = {
  smart: [process.env.GROQ_SMART_MODEL, "openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3-32b"],
  fast: [process.env.GROQ_FAST_MODEL, "openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3-32b"],
};

export class AIError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export const aiConfigured = () => Boolean(process.env.GROQ_API_KEY);

interface AIJsonOptions<T extends z.ZodType> {
  tier: keyof typeof TIERS;
  system: string;
  user: string;
  schema: T;
  name: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  temperature?: number;
}

function jsonSchemaFor(schema: z.ZodType) {
  const js = z.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Model did not return JSON");
  }
}

/** Ask a model for JSON that matches `schema`. Tries each model in the tier in turn. */
export async function aiJSON<T extends z.ZodType>(opts: AIJsonOptions<T>): Promise<z.infer<T>> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new AIError("AI is not configured. Add a free GROQ_API_KEY to enable this feature.", 503);

  const models = TIERS[opts.tier].filter((m): m is string => Boolean(m));
  const schemaJson = jsonSchemaFor(opts.schema);
  let lastError = "No model available";
  let sawRateLimit = false;

  for (const model of models) {
    const reasoning = /gpt-oss|qwen3/.test(model);
    // Try structured output first, then plain JSON mode for models without json_schema.
    for (const mode of ["schema", "object"] as const) {
      const body: Record<string, unknown> = {
        model,
        temperature: opts.temperature ?? 0.2,
        max_completion_tokens: (opts.maxTokens ?? 1200) + (reasoning ? 1500 : 0),
        messages: [
          {
            role: "system",
            content:
              opts.system +
              (mode === "object"
                ? `\n\nReply with one JSON object only, matching this JSON Schema:\n${JSON.stringify(schemaJson)}`
                : ""),
          },
          { role: "user", content: opts.user },
        ],
        response_format:
          mode === "schema"
            ? { type: "json_schema", json_schema: { name: opts.name, schema: schemaJson, strict: false } }
            : { type: "json_object" },
      };
      if (model.includes("gpt-oss")) {
        body.reasoning_effort = opts.effort ?? "low";
        body.include_reasoning = false;
      } else if (model.includes("qwen3")) {
        body.reasoning_format = "hidden";
      }

      let res: Response;
      try {
        res = await fetch(GROQ_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        break; // network or timeout: next model
      }

      if (res.status === 401) throw new AIError("The GROQ_API_KEY was rejected. Check the key.", 503);
      if (res.status === 429) {
        sawRateLimit = true;
        lastError = "Rate limited";
        break;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        lastError = `${res.status} ${detail.slice(0, 300)}`;
        // json_schema unsupported or failed validation on Groq's side: retry in JSON mode.
        if (mode === "schema" && res.status === 400) continue;
        break;
      }

      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content ?? "";
      try {
        const parsed = opts.schema.safeParse(extractJSON(content));
        if (parsed.success) return parsed.data;
        lastError = `Invalid shape: ${parsed.error.issues[0]?.message ?? "unknown"}`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
      if (mode === "schema") continue;
    }
  }

  if (sawRateLimit)
    throw new AIError("The free AI quota is busy right now. Wait a minute and try again.", 429);
  throw new AIError(`AI request failed: ${lastError}`);
}
