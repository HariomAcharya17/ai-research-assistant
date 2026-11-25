"use client";

import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  FileSearch,
  FileUp,
  Lightbulb,
  Lock,
  Quote,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { post } from "@/lib/client/api";
import { ACCEPT, readDocument } from "@/lib/client/files";
import { runResearch } from "@/lib/client/research";
import { useStore } from "@/lib/client/store";
import type { SearchFilters, SourceStatus } from "@/lib/types";
import { Button, Card, cn, Segmented } from "./ui";

const EXAMPLES = [
  "Federated learning to train medical imaging models across hospitals without sharing patient data",
  "Using large language models to grade short-answer exam questions and give feedback to students",
  "Predicting crop yield from satellite imagery and weather data with deep learning in smallholder farms",
  "Detecting phishing websites in real time with lightweight machine learning on URL and page features",
];

function SourceChips({ status }: { status: SourceStatus | null }) {
  const items: { name: string; on: boolean | null; note: string }[] = [
    { name: "OpenAlex", on: status ? status.openalex : null, note: "250M+ works incl. Springer, IEEE, Elsevier, arXiv" },
    { name: "Semantic Scholar", on: status ? status.semanticscholar : null, note: "Extra coverage and abstracts" },
    { name: "Crossref / DataCite", on: status ? true : null, note: "Verified citation details by DOI" },
    { name: "Springer Nature API", on: status ? status.springer : null, note: "Direct search (free key)" },
    { name: "IEEE Xplore API", on: status ? status.ieee : null, note: "Direct search (free key)" },
    { name: "Scopus check", on: status ? status.scopus : null, note: "Journal indexing (free Elsevier key)" },
    { name: "Google Scholar", on: status ? true : null, note: "Link-out per paper (no public API)" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((s) => (
        <span
          key={s.name}
          title={s.note}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]",
            s.on ? "border-border bg-surface text-text" : "border-dashed border-border text-faint",
          )}
        >
          <span className={cn("size-1.5 rounded-full", s.on ? "bg-good" : s.on === false ? "bg-border-strong" : "bg-border")} />
          {s.name}
          {s.on === false && <span className="text-faint">· add key</span>}
        </span>
      ))}
    </div>
  );
}

export function Home({ status }: { status: SourceStatus | null }) {
  const create = useStore((s) => s.create);
  const [mode, setMode] = useState<"idea" | "draft">("idea");
  const [idea, setIdea] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const start = (text: string, title: string, draft?: { name: string; text: string }) => {
    const id = create({ idea: text, title, filters, draft });
    void runResearch(id);
  };

  const submitIdea = () => {
    const text = idea.trim();
    if (text.length < 20) {
      toast.error("Describe your idea in at least a sentence or two.");
      return;
    }
    start(text, "");
  };

  const handleFile = async (file: File) => {
    try {
      setBusy("Reading your draft…");
      const text = (await readDocument(file)).trim();
      if (text.length < 200) throw new Error("Not enough text in the file to understand the draft.");
      setBusy("Understanding the research idea…");
      const res = await post<{ title: string; idea: string; keywords: string[] }>("/api/draft", { text: text.slice(0, 400_000) });
      start(res.idea, res.title, { name: file.name, text });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file");
    } finally {
      setBusy(null);
    }
  };

  const year = new Date().getFullYear();

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-muted">
          <Sparkles className="size-3.5 text-accent" /> Free AI research assistant
        </div>
        <h1 className="font-serif text-[40px] leading-[1.08] tracking-tight sm:text-[54px]">
          Find the papers your idea <em className="text-accent">stands on.</em>
        </h1>
        <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-muted">
          Describe your research or upload a draft. Get related papers ranked and explained, the gaps they leave open, and
          references built from publisher-registered data.
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.08 }}>
        <Card className="mt-8 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "idea", label: "Describe an idea" },
                { value: "draft", label: "Upload a draft" },
              ]}
            />
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition",
                showFilters ? "bg-surface-2 text-text" : "text-muted hover:text-text",
              )}
            >
              <SlidersHorizontal className="size-3.5" /> Filters
              {(filters.yearFrom || filters.yearTo || filters.openAccessOnly) && <span className="size-1.5 rounded-full bg-accent" />}
            </button>
          </div>

          {showFilters && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border bg-surface-2/50 px-4 py-3 text-[13px]">
              <label className="flex items-center gap-2 text-muted">
                From
                <input
                  type="number"
                  min={1900}
                  max={year}
                  placeholder="any"
                  value={filters.yearFrom ?? ""}
                  onChange={(e) => setFilters((f) => ({ ...f, yearFrom: e.target.value ? Number(e.target.value) : undefined }))}
                  className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-text"
                />
              </label>
              <label className="flex items-center gap-2 text-muted">
                To
                <input
                  type="number"
                  min={1900}
                  max={year}
                  placeholder="any"
                  value={filters.yearTo ?? ""}
                  onChange={(e) => setFilters((f) => ({ ...f, yearTo: e.target.value ? Number(e.target.value) : undefined }))}
                  className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-text"
                />
              </label>
              {[5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setFilters((f) => ({ ...f, yearFrom: year - n, yearTo: undefined }))}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-muted hover:text-text"
                >
                  Last {n} years
                </button>
              ))}
              <label className="flex cursor-pointer items-center gap-2 text-muted">
                <input
                  type="checkbox"
                  checked={Boolean(filters.openAccessOnly)}
                  onChange={(e) => setFilters((f) => ({ ...f, openAccessOnly: e.target.checked }))}
                  className="size-4 accent-[var(--accent)]"
                />
                Open access only
              </label>
            </div>
          )}

          {mode === "idea" ? (
            <div className="p-4">
              <textarea
                autoFocus
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitIdea();
                }}
                rows={5}
                maxLength={6000}
                placeholder="What problem are you studying, what approach do you have in mind, and in what setting? A few sentences works best."
                className="w-full resize-none bg-transparent text-[15.5px] leading-relaxed outline-none placeholder:text-faint"
              />
              <div className="mt-2 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[12px] text-faint">
                  {idea.length > 0 ? `${idea.length} / 6000` : "Tip: press ⌘/Ctrl + Enter to search"}
                </span>
                <Button variant="primary" size="lg" onClick={submitIdea} disabled={idea.trim().length < 20}>
                  Find related papers <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <div
                role="button"
                tabIndex={0}
                onClick={() => !busy && fileRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
                onDragOver={(e) => (e.preventDefault(), setDragging(true))}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files[0];
                  if (f && !busy) void handleFile(f);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition",
                  dragging ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong hover:bg-surface-2/50",
                  busy && "cursor-wait",
                )}
              >
                {busy ? (
                  <>
                    <div className="mb-3 size-10 animate-spin rounded-full border-2 border-border border-t-accent" />
                    <p className="text-[15px] font-medium">{busy}</p>
                  </>
                ) : (
                  <>
                    <FileUp className="mb-3 size-8 text-muted" />
                    <p className="text-[15px] font-medium">Drop your draft here, or click to choose</p>
                    <p className="mt-1 text-[13px] text-muted">PDF, DOCX, TXT, MD or LaTeX · up to 30 MB</p>
                  </>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void handleFile(f);
                }}
              />
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-faint">
                <Lock className="size-3" /> The file is read in your browser. Only the opening section is sent to the AI to
                understand the idea.
              </p>
            </div>
          )}
        </Card>

        {mode === "idea" && (
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setIdea(ex)}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[12.5px] text-muted transition hover:border-border-strong hover:text-text"
              >
                {ex.length > 64 ? ex.slice(0, 62) + "…" : ex}
              </button>
            ))}
          </div>
        )}
      </motion.div>

      <section className="mt-16">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-faint">What you get</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { icon: <FileSearch />, t: "Related papers, ranked", d: "Searched across open scholarly indexes, scored against a stated rubric, with the reason for each match." },
            { icon: <BookMarked />, t: "Papers explained", d: "Question, methods, findings and limitations, each linked to the passage it came from." },
            { icon: <Lightbulb />, t: "Research gaps", d: "Limitations the authors state, quoted and checked, kept apart from AI-suggested questions." },
            { icon: <Quote />, t: "References and draft checks", d: "Citations in APA, IEEE, MLA and more from DOI records, plus a wording-overlap check for drafts." },
          ].map((f) => (
            <div key={f.t} className="rounded-xl border border-border bg-surface/60 p-4">
              <div className="mb-2 text-accent [&>svg]:size-5">{f.icon}</div>
              <div className="font-medium">{f.t}</div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Sources</h2>
        <div className="mt-3">
          <SourceChips status={status} />
        </div>
        {status && !status.ai && (
          <p className="mt-3 flex items-center gap-1.5 text-[13px] text-warn">
            <AlertTriangle className="size-3.5 shrink-0" /> AI features are off: add a free GROQ_API_KEY. Search, keyword ranking, citations
            and the draft check still work.
          </p>
        )}
      </section>
    </div>
  );
}
