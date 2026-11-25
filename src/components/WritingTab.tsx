"use client";

import { diffWords } from "diff";
import { AlertTriangle, Copy, PenLine, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { post } from "@/lib/client/api";
import { authorLine, inTextCitation } from "@/lib/cite";
import type { Project } from "@/lib/client/store";
import { AiOff, Button, Callout, Card, cn, copyText, Segmented } from "./ui";

type Mode = "grammar" | "clarity" | "structure" | "paraphrase";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "grammar", label: "Grammar", hint: "Fix errors, keep your wording." },
  { value: "clarity", label: "Clarity", hint: "Shorter, more precise academic sentences." },
  { value: "structure", label: "Structure", hint: "Better order, topic sentences and flow." },
  { value: "paraphrase", label: "Cited paraphrase", hint: "Restate a source in new words, with its citation." },
];

interface Result {
  revised: string;
  changes: string[];
  note?: string;
}

export function WritingTab({ project, ai, onTab }: { project: Project; ai: boolean; onTab?: (t: "papers" | "refs" | "draft") => void }) {
  const [mode, setMode] = useState<Mode>("clarity");
  const [text, setText] = useState("");
  const [sourceId, setSourceId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [view, setView] = useState<"changes" | "clean">("changes");
  const [input, setInput] = useState("");

  const candidates = useMemo(() => {
    const refs = project.refs.map((id) => project.papers.find((p) => p.id === id)).filter((p) => p !== undefined);
    const rest = project.papers.filter((p) => !project.refs.includes(p.id));
    return [...refs, ...rest];
  }, [project.papers, project.refs]);

  const source = candidates.find((p) => p.id === sourceId);
  const refNumber = source ? (project.refs.includes(source.id) ? project.refs.indexOf(source.id) + 1 : project.refs.length + 1) : 0;
  const inText = source ? inTextCitation(source, project.style, refNumber) : "";

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const ft = source ? project.fulltext[source.id] : undefined;
      const r = await post<Result>("/api/write", {
        mode,
        text,
        source:
          mode === "paraphrase" && source
            ? { title: source.title, inText, excerpt: source.abstract ?? ft?.passages.slice(0, 3).map((p) => p.text).join(" ") }
            : undefined,
      });
      setInput(text);
      setResult(r);
      setView("changes");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revise the text");
    } finally {
      setBusy(false);
    }
  };

  const parts = useMemo(() => (result ? diffWords(input, result.revised) : []), [result, input]);

  if (!ai)
    return (
      <AiOff
        icon={<PenLine className="size-5" />}
        title="Writing help"
        what="Fix grammar, make sentences clearer, improve structure, or paraphrase a source while keeping its citation. Every change is shown word by word."
        onTab={onTab}
      />
    );

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Segmented value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m.value, label: m.label }))} className="max-w-full overflow-x-auto" />
          <span className="text-[12.5px] text-muted">{MODES.find((m) => m.value === mode)?.hint}</span>
        </div>

        {mode === "paraphrase" && (
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block">
              <span className="text-[12px] font-medium text-muted">Source you are paraphrasing</span>
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-2.5 text-[13.5px]"
              >
                <option value="">Choose a paper…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {project.refs.includes(p.id) ? "★ " : ""}
                    {authorLine(p.authors, 1)} ({p.year ?? "n.d."}): {p.title.slice(0, 80)}
                  </option>
                ))}
              </select>
            </label>
            {source && (
              <div className="rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
                Cites as <span className="font-semibold">{inText}</span>
              </div>
            )}
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          maxLength={8000}
          placeholder={mode === "paraphrase" ? "Paste the passage from the source that you want to restate…" : "Paste a paragraph or section of your writing…"}
          className="mt-4 w-full resize-y rounded-lg border border-border bg-surface p-3 text-[14.5px] leading-relaxed outline-none placeholder:text-faint focus:border-accent"
        />
        <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-[12px] text-faint">
            <ShieldCheck className="size-3.5" /> Improves writing; it does not disguise copied text or bypass plagiarism checks.
          </p>
          <Button
            variant="primary"
            loading={busy}
            disabled={text.trim().length < 20 || (mode === "paraphrase" && !source)}
            onClick={run}
            icon={<Sparkles className="size-4" />}
          >
            Revise
          </Button>
        </div>
      </Card>

      {result && (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "changes", label: "Show changes" },
                { value: "clean", label: "Clean" },
              ]}
            />
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy className="size-3.5" />}
              onClick={async () => ((await copyText(result.revised)) ? toast.success("Copied") : toast.error("Copy failed"))}
            >
              Copy revised text
            </Button>
          </div>
          {result.note && (
            <Callout tone="warn" icon={<AlertTriangle />} className="mt-4">
              {result.note}
            </Callout>
          )}
          <div className="mt-4 whitespace-pre-wrap font-serif text-[15.5px] leading-[1.8]">
            {view === "clean"
              ? result.revised
              : parts.map((p, i) => (
                  <span
                    key={i}
                    className={cn(p.added && "rounded-sm bg-good-soft text-good", p.removed && "rounded-sm bg-bad-soft text-bad line-through")}
                  >
                    {p.value}
                  </span>
                ))}
          </div>
          {result.changes.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">What changed</div>
              <ul className="mt-2 space-y-1.5">
                {result.changes.map((c, i) => (
                  <li key={i} className="flex gap-2 text-[13.5px] text-muted">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-faint" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
