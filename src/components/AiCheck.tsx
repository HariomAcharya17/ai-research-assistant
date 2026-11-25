"use client";

import { AlertTriangle, Bot, Info, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DETECTORS,
  LIKELY_AI,
  MIN_WORDS,
  POSSIBLE_AI,
  prepareChunks,
  summarize,
  type AiLevel,
  type Scores,
} from "@/lib/aidetect";
import { detectAI } from "@/lib/client/aidetect";
import { Badge, Button, Callout, Card, cn } from "./ui";

type Phase =
  | { kind: "idle" }
  | { kind: "download"; loaded: number; total: number }
  | { kind: "scoring"; done: number; total: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

// Results survive switching tabs; keyed by the exact text checked.
const cache = new Map<string, (Scores | undefined)[]>();

const LEVEL: Record<AiLevel, { label: string; tone: "bad" | "warn" | "good" | "neutral"; text: string }> = {
  "likely-ai": {
    label: "Likely AI",
    tone: "bad",
    text: `Both detectors scored this ${Math.round(LIKELY_AI * 100)}% or higher.`,
  },
  "possible-ai": {
    label: "Possibly AI",
    tone: "warn",
    text: `One detector scored this ${Math.round(POSSIBLE_AI * 100)}% or higher, but they do not agree. Human formal writing and lightly edited AI text both land here.`,
  },
  "likely-human": { label: "Likely human", tone: "good", text: "Neither detector found strong signs of AI writing." },
  unscored: { label: "Not scored", tone: "neutral", text: `Fewer than ${MIN_WORDS} words of unquoted text. Too short to judge.` },
};

const mb = (b: number) => `${Math.round(b / 1e6)} MB`;

export function AiCheck({ text }: { text: string }) {
  const prepared = useMemo(() => prepareChunks(text), [text]);
  const [scores, setScores] = useState<(Scores | undefined)[] | null>(() => cache.get(text) ?? null);
  const [phase, setPhase] = useState<Phase>(() => (cache.has(text) ? { kind: "done" } : { kind: "idle" }));
  const [selected, setSelected] = useState<number | null>(null);
  const [checkedText, setCheckedText] = useState(text);

  // A different draft was loaded: show its cached result or start fresh.
  if (checkedText !== text) {
    setCheckedText(text);
    setScores(cache.get(text) ?? null);
    setPhase(cache.has(text) ? { kind: "done" } : { kind: "idle" });
    setSelected(null);
  }

  const report = useMemo(() => (scores ? summarize(prepared.chunks, scores) : null), [prepared, scores]);
  const scorable = prepared.chunks.filter((c) => c.words >= MIN_WORDS);
  const running = phase.kind === "download" || phase.kind === "scoring";

  const run = async () => {
    const texts = prepared.chunks.map((c) => (c.words >= MIN_WORDS ? c.scoreText : ""));
    const out: (Scores | undefined)[] = new Array(texts.length).fill(undefined);
    let done = 0;
    setSelected(null);
    setScores(null);
    setPhase({ kind: "download", loaded: 0, total: 0 });
    try {
      await detectAI(texts, {
        onDownload: (loaded, total) => setPhase({ kind: "download", loaded, total }),
        onReady: () => setPhase({ kind: "scoring", done: 0, total: scorable.length }),
        onScore: (i, s) => {
          out[i] = s;
          done++;
          setPhase({ kind: "scoring", done, total: scorable.length });
        },
      });
      cache.set(text, out);
      setScores(out);
      setPhase({ kind: "done" });
      const firstAi = out.findIndex((s, i) => s && Math.min(...Object.values(s)) >= LIKELY_AI && prepared.chunks[i].words >= MIN_WORDS);
      setSelected(firstAi >= 0 ? firstAi : null);
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "The check failed." });
    }
  };

  const sel = selected !== null ? prepared.chunks[selected] : null;
  const selLevel = selected !== null && report ? report.levels[selected] : null;

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <h3 className="font-medium">AI writing check</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Two open detection models read your draft in chunks of about 200 words and estimate how likely each chunk
              is to be AI-generated. Everything runs on this device: your text is never uploaded. The first run
              downloads the models (about 250 MB) and later runs reuse them.
            </p>
          </div>
          <Button variant="primary" icon={<Bot className="size-4" />} loading={running} disabled={running || !scorable.length} onClick={run}>
            {phase.kind === "done" ? "Check again" : "Run AI check"}
          </Button>
        </div>

        {phase.kind === "download" && (
          <Progress
            label={phase.total ? `Downloading detection models · ${mb(phase.loaded)} of ${mb(phase.total)}` : "Preparing detection models…"}
            value={phase.total ? phase.loaded / phase.total : 0}
          />
        )}
        {phase.kind === "scoring" && (
          <Progress label={`Reading chunk ${Math.min(phase.done + 1, phase.total)} of ${phase.total}`} value={phase.total ? phase.done / phase.total : 0} />
        )}
        {phase.kind === "error" && (
          <Callout tone="bad" icon={<AlertTriangle />} className="mt-3">
            {phase.message}
          </Callout>
        )}
        {!scorable.length && (
          <Callout tone="warn" icon={<AlertTriangle />} className="mt-3">
            The draft needs at least one passage of {MIN_WORDS}+ words of unquoted prose to check.
          </Callout>
        )}
      </Card>

      {!prepared.likelyEnglish && (
        <Callout tone="warn" icon={<AlertTriangle />}>
          This draft does not look like English. Both detectors were trained on English text, so results for other
          languages are not reliable.
        </Callout>
      )}

      <Callout icon={<Info />}>
        <strong className="font-medium text-text">This is an estimate, not proof.</strong> No AI detector is 100%
        accurate. Polished academic writing by people is sometimes flagged: in our test on 25 human-written research
        abstracts from before ChatGPT existed, 2 were marked likely AI and 8 more possibly AI. Heavily rewritten AI text
        can also pass as human. Do not use this result alone to accuse anyone of misconduct.
      </Callout>

      {report && phase.kind === "done" && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { l: "Likely AI", v: report.share.likelyAi, tone: "text-bad" },
              { l: "Possibly AI", v: report.share.possibleAi, tone: "text-warn" },
              { l: "Likely human", v: report.share.likelyHuman, tone: "text-good" },
            ].map((s) => (
              <Card key={s.l} className="p-3.5 shadow-none">
                <div className={cn("font-serif text-[28px] leading-none tabular-nums", s.tone)}>{s.v}%</div>
                <div className="mt-1.5 text-[12px] text-muted">{s.l}</div>
              </Card>
            ))}
          </div>
          <p className="text-[12px] text-faint">
            Share of {report.scoredWords.toLocaleString()} scored words.
            {report.words.unscored > 0 && ` ${report.words.unscored.toLocaleString()} words in short passages were not scored.`}
            {report.quotedWords > 0 && ` ${report.quotedWords.toLocaleString()} quoted words were left out.`}
            {prepared.referencesCut && " The reference list was left out."}
          </p>

          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <Card className="scroll-thin max-h-[640px] overflow-y-auto p-5 shadow-none">
              <div className="space-y-3 font-serif text-[15.5px] leading-[1.8]">
                {prepared.chunks.map((c, i) => {
                  const lvl = report.levels[i];
                  const showHeading = c.heading && c.heading !== prepared.chunks[i - 1]?.heading;
                  return (
                    <div key={c.id}>
                      {showHeading && <div className="mb-1 font-sans text-[12px] font-semibold uppercase tracking-wider text-faint">{c.heading}</div>}
                      <button
                        onClick={() => setSelected(i)}
                        className={cn(
                          "block w-full whitespace-pre-line rounded-md px-2 py-1 text-left transition",
                          lvl === "likely-ai" && "bg-bad-soft",
                          lvl === "possible-ai" && "bg-warn-soft",
                          lvl === "unscored" && "text-muted",
                          selected === i ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-border",
                        )}
                      >
                        {c.text}
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>

            <div className="space-y-3 lg:sticky lg:top-16 lg:self-start">
              {sel && selLevel ? (
                <Card className="p-4 shadow-none">
                  <Badge tone={LEVEL[selLevel].tone}>{LEVEL[selLevel].label}</Badge>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted">{LEVEL[selLevel].text}</p>
                  {scores?.[sel.id] && (
                    <ul className="mt-3 space-y-2.5">
                      {DETECTORS.map((d) => {
                        const v = scores[sel.id]![d.key];
                        return (
                          <li key={d.key}>
                            <div className="flex justify-between text-[12.5px]">
                              <span className="font-medium">{d.name}</span>
                              <span className="tabular-nums text-muted">{(v * 100).toFixed(1)}% AI</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                              <div
                                className={cn("h-full rounded-full", v >= LIKELY_AI ? "bg-bad" : v >= POSSIBLE_AI ? "bg-warn" : "bg-good")}
                                style={{ width: `${Math.max(2, v * 100)}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="mt-3 text-[12px] text-faint">
                    {sel.words} words scored{sel.quotedWords ? `, ${sel.quotedWords} quoted words left out` : ""}.
                  </p>
                </Card>
              ) : (
                <Card className="p-4 text-[13px] text-muted shadow-none">Click a passage to see both detectors’ scores.</Card>
              )}
              <Card className="p-4 shadow-none">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  <ShieldCheck className="size-3.5" /> How it decides
                </div>
                <ul className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-muted">
                  <li>
                    <span className="text-bad">Likely AI</span>: both models ≥ {Math.round(LIKELY_AI * 100)}%.
                  </li>
                  <li>
                    <span className="text-warn">Possibly AI</span>: one model ≥ {Math.round(POSSIBLE_AI * 100)}%.
                  </li>
                  <li>
                    <span className="text-good">Likely human</span>: both below {Math.round(POSSIBLE_AI * 100)}%.
                  </li>
                  {DETECTORS.map((d) => (
                    <li key={d.key}>
                      <a href={d.link} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                        {d.name}
                      </a>
                      : {d.about}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div className="mt-4">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}
