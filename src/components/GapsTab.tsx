"use client";

import { AlertTriangle, Lightbulb, Quote, RotateCw, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { authorLine } from "@/lib/cite";
import { findGaps } from "@/lib/client/research";
import type { Project } from "@/lib/client/store";
import { Badge, Button, Callout, Card, cn, Empty } from "./ui";

export function GapsTab({ project, ai, onOpen }: { project: Project; ai: boolean; onOpen: (id: string) => void }) {
  const usable = useMemo(
    () => project.papers.filter((p) => p.abstract || project.fulltext[p.id]),
    [project.papers, project.fulltext],
  );
  const [picked, setPicked] = useState<string[]>(() => usable.slice(0, 8).map((p) => p.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState(0);
  const [showPicker, setShowPicker] = useState(!project.gaps);
  const byId = useMemo(() => new Map(project.papers.map((p) => [p.id, p])), [project.papers]);
  const gaps = project.gaps;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await findGaps(project.id, picked);
      setDropped(r.dropped);
      setShowPicker(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not analyse the papers");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 12 ? p : [...p, id]));

  if (!ai)
    return (
      <Empty icon={<Lightbulb className="size-5" />} title="Gap analysis needs AI">
        Add a free GROQ_API_KEY to the deployment to compare papers and find gaps.
      </Empty>
    );

  const fullCount = picked.filter((id) => project.fulltext[id]).length;

  return (
    <div className="space-y-6">
      {showPicker ? (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-serif text-[20px]">Compare papers to find gaps</h3>
              <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-muted">
                Pick 2–12 papers. Papers whose full text you have loaded (by explaining them) give better results:
                limitations sections rarely appear in abstracts.
              </p>
            </div>
            <Button variant="primary" onClick={run} loading={busy} disabled={picked.length < 2} icon={<Sparkles className="size-4" />}>
              Find gaps in {picked.length} papers
            </Button>
          </div>
          <p className="mt-3 text-[12.5px] text-muted">
            {fullCount} of {picked.length} selected have full text loaded.
          </p>
          <div className="scroll-thin mt-3 max-h-[340px] space-y-1 overflow-y-auto rounded-lg border border-border p-1.5">
            {usable.map((p) => (
              <label
                key={p.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md px-2.5 py-2 transition",
                  picked.includes(p.id) ? "bg-accent-soft/50" : "hover:bg-surface-2",
                )}
              >
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} className="mt-1 accent-[var(--accent)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] leading-snug">{p.title}</span>
                  <span className="text-[12px] text-muted">
                    {authorLine(p.authors, 2)} · {p.year ?? "n.d."}
                  </span>
                </span>
                {project.fulltext[p.id] ? <Badge tone="good">Full text</Badge> : <Badge>Abstract</Badge>}
              </label>
            ))}
          </div>
          {error && (
            <Callout tone="bad" icon={<AlertTriangle />} className="mt-3">
              {error}
            </Callout>
          )}
        </Card>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-muted">
            Generated {gaps && new Date(gaps.createdAt).toLocaleString()} from {picked.length} papers.
          </p>
          <Button size="sm" variant="secondary" icon={<RotateCw className="size-3.5" />} onClick={() => setShowPicker(true)}>
            Change papers
          </Button>
        </div>
      )}

      {gaps && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section>
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="size-4 text-good" />
              <h3 className="font-serif text-[20px]">Stated by the authors</h3>
            </div>
            <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
              Limitations and open problems the papers themselves mention. Every quote was checked word for word against
              the paper text{dropped > 0 && `; ${dropped} unverifiable item${dropped > 1 ? "s were" : " was"} removed`}.
            </p>
            {gaps.stated.length === 0 ? (
              <Callout>No limitations are stated in the text available. Load full texts by explaining papers, then try again.</Callout>
            ) : (
              <div className="space-y-2.5">
                {gaps.stated.map((s, i) => {
                  const p = byId.get(s.paperId);
                  return (
                    <Card key={i} className="p-3.5 shadow-none">
                      <p className="text-[14px] font-medium leading-snug">{s.limitation}</p>
                      <blockquote className="mt-2 flex gap-2 border-l-2 border-good pl-3 font-serif text-[14px] italic leading-relaxed text-muted">
                        <Quote className="mt-1 size-3 shrink-0 opacity-50" />“{s.quote}”
                      </blockquote>
                      {p && (
                        <button onClick={() => onOpen(p.id)} className="mt-2 text-left text-[12px] text-accent hover:underline">
                          {authorLine(p.authors, 1)} ({p.year ?? "n.d."}) · {s.basis === "fulltext" ? "full text" : "abstract"}
                        </button>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="size-4 text-ai" />
              <h3 className="font-serif text-[20px]">AI-suggested questions</h3>
            </div>
            <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
              Ideas generated by AI from the papers above. They are starting points, not established gaps: check the
              literature before you build on one.
            </p>
            <div className="space-y-2.5">
              {gaps.suggested.map((q, i) => (
                <Card key={i} className="border-ai/25 bg-ai-soft/30 p-3.5 shadow-none">
                  <div className="flex items-start gap-2">
                    <Badge tone="ai" className="mt-0.5">AI</Badge>
                    <p className="text-[14.5px] font-medium leading-snug">{q.question}</p>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{q.rationale}</p>
                  {q.buildsOn.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="text-[11.5px] text-faint">Builds on</span>
                      {q.buildsOn.map((id) => {
                        const p = byId.get(id);
                        return p ? (
                          <button
                            key={id}
                            onClick={() => onOpen(id)}
                            className="rounded border border-border bg-surface px-1.5 text-[11.5px] text-muted hover:text-text"
                          >
                            {authorLine(p.authors, 1).split(",")[0]} {p.year ?? ""}
                          </button>
                        ) : null;
                      })}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
