"use client";

import { AlertTriangle, BookmarkCheck, BookmarkPlus, FileText, FileUp, RotateCw, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { readPaperPdf } from "@/lib/client/files";
import { canFetchFullText, explainPaper, saveUploadedFullText, toggleRef } from "@/lib/client/research";
import type { Project } from "@/lib/client/store";
import type { Claim, Paper, Passage, Summary } from "@/lib/types";
import { PaperLinks, RelevanceMeter, SourceBadges } from "./PaperBits";
import { Badge, Button, Callout, cn } from "./ui";

function RefChip({ id, passage, active, onClick }: { id: string; passage?: Passage; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "ml-1 inline-flex translate-y-[-1px] items-center rounded px-1 py-px align-middle text-[10.5px] font-semibold tabular-nums transition",
        active ? "bg-accent text-accent-ink" : "bg-accent-soft text-accent-text hover:brightness-95",
      )}
      title={passage ? `${passage.section}${passage.page ? `, page ${passage.page}` : ""}` : id}
    >
      {passage?.page ? `p.${passage.page}` : id === "abs" ? "abstract" : id}
    </button>
  );
}

function ClaimList({
  title,
  claims,
  passages,
  active,
  onRef,
  empty,
}: {
  title: string;
  claims: Claim[];
  passages: Map<string, Passage>;
  active: string | null;
  onRef: (id: string) => void;
  empty?: string;
}) {
  return (
    <section className="mt-5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-faint">{title}</h4>
      {claims.length === 0 ? (
        <p className="mt-1.5 text-[13.5px] italic text-faint">{empty ?? "Nothing stated."}</p>
      ) : (
        <ul className="mt-1.5 space-y-2">
          {claims.map((c, i) => (
            <li key={i} className="flex gap-2 text-[14px] leading-relaxed">
              <span className="mt-[9px] size-1 shrink-0 rounded-full bg-faint" />
              <span>
                {c.text}
                {c.refs.map((r) => (
                  <RefChip key={r} id={r} passage={passages.get(r)} active={active === r} onClick={() => onRef(r)} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SummaryView({ summary, passages }: { summary: Summary; passages: Passage[] }) {
  const [active, setActive] = useState<string | null>(null);
  const byId = useMemo(() => new Map(passages.map((p) => [p.id, p])), [passages]);
  const cited = useMemo(() => {
    const ids = new Set(
      [summary.researchQuestion, ...summary.methods, ...summary.findings, ...summary.limitations].flatMap((c) => c.refs),
    );
    return passages.filter((p) => ids.has(p.id));
  }, [summary, passages]);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  const onRef = (id: string) => {
    setActive(id);
    refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div>
      <ClaimList title="Research question" claims={[summary.researchQuestion]} passages={byId} active={active} onRef={onRef} />
      <ClaimList title="Methods" claims={summary.methods} passages={byId} active={active} onRef={onRef} />
      <ClaimList title="Findings" claims={summary.findings} passages={byId} active={active} onRef={onRef} />
      <ClaimList
        title="Limitations stated by the authors"
        claims={summary.limitations}
        passages={byId}
        active={active}
        onRef={onRef}
        empty={
          summary.basis === "abstract"
            ? "None stated in the abstract. The full text may list some."
            : "None found in the passages read."
        }
      />

      {cited.length > 0 && (
        <section className="mt-7">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Source passages</h4>
          <div className="mt-2 space-y-2">
            {cited.map((p) => (
              <div
                key={p.id}
                ref={(el) => {
                  refs.current[p.id] = el;
                }}
                className={cn(
                  "rounded-lg border px-3 py-2.5 transition",
                  active === p.id ? "border-accent bg-accent-soft/50" : "border-border bg-surface-2/40",
                )}
              >
                <div className="mb-1 flex items-center gap-2 text-[11.5px] font-medium text-muted">
                  <span className="rounded bg-surface px-1 tabular-nums">{p.id}</span>
                  {p.section}
                  {p.page && <span className="text-faint">· page {p.page}</span>}
                </div>
                <p className="font-serif text-[14.5px] leading-relaxed">{p.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function PaperDrawer({
  project,
  paper,
  onClose,
  ai,
}: {
  project: Project;
  paper: Paper | null;
  onClose: () => void;
  ai: boolean;
}) {
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [absOpen, setAbsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset per-paper state when another paper opens (adjusting state during render).
  const [shownId, setShownId] = useState(paper?.id);
  if (paper?.id !== shownId) {
    setShownId(paper?.id);
    setError(null);
    setPhase(null);
    setAbsOpen(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const summary = paper ? project.summaries[paper.id] : undefined;
  const fulltext = paper ? project.fulltext[paper.id] : undefined;
  const passages: Passage[] = summary
    ? summary.basis === "fulltext" && fulltext
      ? fulltext.passages
      : paper?.abstract
        ? [{ id: "abs", section: "Abstract", text: paper.abstract }]
        : []
    : [];

  const explain = async (useFull: boolean) => {
    if (!paper) return;
    setError(null);
    try {
      setPhase(useFull && !fulltext ? "Finding an open-access full text…" : "Reading and explaining…");
      if (useFull && !fulltext) {
        // Phase text switches once the full text has arrived.
        const t = setTimeout(() => setPhase("Reading and explaining…"), 4000);
        await explainPaper(project.id, paper, true).finally(() => clearTimeout(t));
      } else {
        await explainPaper(project.id, paper, useFull);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not explain this paper");
    } finally {
      setPhase(null);
    }
  };

  const upload = async (file: File) => {
    if (!paper) return;
    setError(null);
    try {
      setPhase("Reading the PDF in your browser…");
      const { passages, pages } = await readPaperPdf(file);
      saveUploadedFullText(project.id, paper.id, passages, pages);
      toast.success(`Loaded ${passages.length} passages from ${pages} pages`);
      setPhase("Reading and explaining…");
      await explainPaper(project.id, paper, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the PDF");
    } finally {
      setPhase(null);
    }
  };

  const inRefs = paper ? project.refs.includes(paper.id) : false;
  const canFetch = paper ? canFetchFullText(paper) : false;

  return (
    <AnimatePresence>
      {paper && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label={paper.title}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[680px] flex-col border-l border-border bg-surface shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
              <RelevanceMeter paper={paper} compact />
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleRef(project.id, paper.id)}
                  icon={inRefs ? <BookmarkCheck className="size-4 text-accent" /> : <BookmarkPlus className="size-4" />}
                >
                  {inRefs ? "In references" : "Cite"}
                </Button>
                <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2">
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="scroll-thin flex-1 overflow-y-auto px-5 pb-10 pt-5 sm:px-7">
              <SourceBadges paper={paper} />
              <h2 className="mt-3 font-serif text-[25px] leading-tight tracking-tight">{paper.title}</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{paper.authors.join(", ") || "Unknown authors"}</p>
              <p className="mt-1 text-[13px] text-muted">
                {[paper.year, paper.venue, paper.publisher].filter(Boolean).join(" · ")}
                {paper.doi && <span className="text-faint"> · doi:{paper.doi}</span>}
              </p>
              <PaperLinks paper={paper} className="-ml-1.5 mt-2" />

              {paper.relevance?.method === "ai" && (
                <div className="mt-4 rounded-lg bg-surface-2/70 px-3.5 py-3 text-[13.5px] leading-relaxed">
                  <span className="font-medium">Why it matches your idea: </span>
                  {paper.relevance.why}
                </div>
              )}

              {paper.abstract && (
                <section className="mt-5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Abstract</h4>
                  <p className={cn("mt-1.5 font-serif text-[15px] leading-relaxed", !absOpen && "line-clamp-5")}>{paper.abstract}</p>
                  {paper.abstract.length > 420 && (
                    <button onClick={() => setAbsOpen((v) => !v)} className="mt-1 text-[12.5px] font-medium text-accent">
                      {absOpen ? "Show less" : "Show full abstract"}
                    </button>
                  )}
                </section>
              )}

              <div className="my-6 h-px bg-border" />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-serif text-[21px]">
                  <Sparkles className="size-4 text-ai" /> Explained
                </h3>
                {summary && (
                  <div className="flex items-center gap-2">
                    <Badge tone={summary.basis === "fulltext" ? "good" : "warn"}>
                      {summary.basis === "fulltext"
                        ? `From full text${fulltext?.origin === "upload" ? " (your PDF)" : fulltext?.via ? ` · ${fulltext.via}` : ""}`
                        : "From abstract only"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!phase || !ai}
                      onClick={() => explain(Boolean(fulltext) || canFetch)}
                      icon={<RotateCw className="size-3.5" />}
                    >
                      Redo
                    </Button>
                  </div>
                )}
              </div>

              {!ai && (
                <Callout tone="warn" icon={<AlertTriangle />} className="mt-3">
                  AI is not configured on this deployment, so papers cannot be explained yet.
                </Callout>
              )}

              {phase ? (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2 text-[13.5px] text-muted">
                    <span className="size-3.5 animate-spin rounded-full border-2 border-border border-t-ai" />
                    {phase}
                  </div>
                  {[90, 75, 82, 60].map((w, i) => (
                    <div key={i} className="skeleton h-3.5" style={{ width: `${w}%` }} />
                  ))}
                </div>
              ) : summary ? (
                <>
                  {summary.basis === "abstract" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                      Based on the abstract only.
                      {canFetch && ai && (
                        <button className="font-medium text-accent" onClick={() => explain(true)}>
                          Read the full text
                        </button>
                      )}
                      {ai && (
                        <button className="font-medium text-accent" onClick={() => fileRef.current?.click()}>
                          Upload the PDF
                        </button>
                      )}
                    </div>
                  )}
                  <SummaryView summary={summary} passages={passages} />
                  <p className="mt-6 text-[12px] leading-relaxed text-faint">
                    AI-written summary. Each point links to the passage it was drawn from; check those before you rely on it.
                  </p>
                </>
              ) : (
                ai && (
                  <div className="mt-3">
                    <p className="text-[13.5px] leading-relaxed text-muted">
                      Get the research question, methods, findings and author-stated limitations, each linked to its
                      source passage.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canFetch && (
                        <Button variant="primary" onClick={() => explain(true)} icon={<FileText className="size-4" />}>
                          Read full text and explain
                        </Button>
                      )}
                      {paper.abstract && (
                        <Button variant={canFetch ? "secondary" : "primary"} onClick={() => explain(false)} icon={<Sparkles className="size-4" />}>
                          Explain from abstract
                        </Button>
                      )}
                      <Button variant="secondary" onClick={() => fileRef.current?.click()} icon={<FileUp className="size-4" />}>
                        Upload PDF
                      </Button>
                    </div>
                    <p className="mt-2.5 text-[12.5px] text-faint">
                      {canFetch
                        ? "The full text is looked up in PubMed Central, the open-access PDF, arXiv and OpenAlex."
                        : "No open-access copy is known for this paper. If you have access through your library, upload the PDF."}
                    </p>
                  </div>
                )
              )}

              {error && (
                <Callout tone="bad" icon={<AlertTriangle />} className="mt-4">
                  {error}
                  {!summary && (
                    <span className="mt-1 block">
                      {paper.abstract && (
                        <button className="mr-3 font-medium underline" onClick={() => explain(false)}>
                          Explain from the abstract
                        </button>
                      )}
                      <button className="font-medium underline" onClick={() => fileRef.current?.click()}>
                        Upload the PDF
                      </button>
                    </span>
                  )}
                </Callout>
              )}

              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void upload(f);
                }}
              />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
