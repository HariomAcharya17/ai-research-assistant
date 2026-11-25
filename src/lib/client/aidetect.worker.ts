// Web worker that runs the AI-writing detectors with Transformers.js.
// The models are downloaded from Hugging Face once and cached by the browser;
// the user's text never leaves the device.

import { env, pipeline, type TextClassificationPipeline } from "@huggingface/transformers";
import { DETECTORS, type DetectorKey } from "@/lib/aidetect";

env.allowLocalModels = false;

export type WorkerIn = { type: "run"; texts: string[] };
export type WorkerOut =
  | { type: "download"; loaded: number; total: number }
  | { type: "ready" }
  | { type: "score"; index: number; scores: Record<DetectorKey, number> }
  | { type: "done" }
  | { type: "error"; message: string };

const post = (m: WorkerOut) => self.postMessage(m);

let models: Promise<Record<DetectorKey, TextClassificationPipeline>> | null = null;

function load() {
  if (models) return models;
  // Track bytes across every file of both models for one progress bar.
  const files = new Map<string, { loaded: number; total: number }>();
  const onProgress = (p: { status: string; file?: string; name?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file || !p.total) return;
    files.set(`${p.name}/${p.file}`, { loaded: p.loaded ?? 0, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: "download", loaded, total });
  };
  models = (async () => {
    const entries = await Promise.all(
      DETECTORS.map(async (d) => {
        const clf = (await pipeline("text-classification", d.repo, {
          dtype: "q8",
          device: "wasm",
          revision: d.revision,
          progress_callback: onProgress,
        })) as TextClassificationPipeline;
        return [d.key, clf] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<DetectorKey, TextClassificationPipeline>;
  })();
  models.catch(() => {
    models = null;
  });
  return models;
}

async function aiScore(clf: TextClassificationPipeline, text: string): Promise<number> {
  const out = (await clf(text, { top_k: 2 })) as { label: string; score: number }[];
  const ai = out.find((l) => /^ai$/i.test(l.label));
  if (!ai) throw new Error(`Unexpected labels: ${out.map((l) => l.label).join(", ")}`);
  return ai.score;
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  if (e.data.type !== "run") return;
  try {
    const m = await load();
    post({ type: "ready" });
    for (let i = 0; i < e.data.texts.length; i++) {
      const t = e.data.texts[i];
      if (!t) continue;
      const scores = {} as Record<DetectorKey, number>;
      for (const d of DETECTORS) scores[d.key] = await aiScore(m[d.key], t);
      post({ type: "score", index: i, scores });
    }
    post({ type: "done" });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
