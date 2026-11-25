"use client";

import type { Scores } from "@/lib/aidetect";
import type { WorkerIn, WorkerOut } from "./aidetect.worker";

let worker: Worker | null = null;
let busy = false;

export interface DetectCallbacks {
  onDownload?: (loaded: number, total: number) => void;
  onReady?: () => void;
  onScore?: (index: number, scores: Scores) => void;
}

/**
 * Score texts with both detectors in a background worker.
 * Empty strings are skipped (their index gets no score).
 */
export function detectAI(texts: string[], cb: DetectCallbacks = {}): Promise<void> {
  if (busy) return Promise.reject(new Error("A check is already running."));
  if (typeof Worker === "undefined") return Promise.reject(new Error("This browser cannot run the AI check."));
  worker ??= new Worker(new URL("./aidetect.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  busy = true;
  return new Promise<void>((resolve, reject) => {
    const finish = (err?: Error) => {
      busy = false;
      w.onmessage = null;
      w.onerror = null;
      if (err) reject(err);
      else resolve();
    };
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "download") cb.onDownload?.(m.loaded, m.total);
      else if (m.type === "ready") cb.onReady?.();
      else if (m.type === "score") cb.onScore?.(m.index, m.scores);
      else if (m.type === "done") finish();
      else if (m.type === "error") finish(new Error(m.message));
    };
    w.onerror = (e) => {
      // A crashed worker cannot be reused.
      worker = null;
      w.terminate();
      finish(new Error(e.message || "The AI check stopped unexpectedly."));
    };
    w.postMessage({ type: "run", texts } satisfies WorkerIn);
  });
}
