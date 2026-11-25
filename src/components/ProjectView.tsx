"use client";

import {
  AlertTriangle,
  BookMarked,
  Check,
  ChevronDown,
  FileSearch,
  Lightbulb,
  PenLine,
  RotateCw,
  ScanText,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { runResearch } from "@/lib/client/research";
import type { Project, StepState } from "@/lib/client/store";
import { SOURCE_NAMES, type SourceStatus } from "@/lib/types";
import { DraftTab } from "./DraftTab";
import { GapsTab } from "./GapsTab";
import { PaperDrawer } from "./PaperDrawer";
import { PapersTab } from "./PapersTab";
import { ReferencesTab } from "./ReferencesTab";
import { Button, Callout, cn, Spinner } from "./ui";
import { WritingTab } from "./WritingTab";

type Tab = "papers" | "gaps" | "refs" | "draft" | "write";

function StepIcon({ state }: { state: StepState }) {
  if (state === "active") return <Spinner />;
  if (state === "done") return <Check className="size-4 text-good" />;
  if (state === "error") return <X className="size-4 text-bad" />;
  if (state === "skipped") return <AlertTriangle className="size-4 text-warn" />;
  return <span className="block size-2 rounded-full bg-border-strong" />;
}

function Progress({ project }: { project: Project }) {
  const steps = [
    { key: "plan" as const, label: "Understanding your idea", sub: "Turning it into database searches" },
    { key: "search" as const, label: "Searching scholarly sources", sub: "OpenAlex, Semantic Scholar and any keyed APIs" },
    { key: "rank" as const, label: "Ranking and explaining matches", sub: "Scoring each paper against your idea" },
  ];
  return (
    <div className="mt-6 rounded-xl border border-border bg-surface p-2">
      {steps.map((s) => {
        const st = project.steps[s.key];
        return (
          <div key={s.key} className={cn("flex items-start gap-3 rounded-lg px-3 py-3", st.state === "active" && "bg-surface-2/70")}>
            <div className="grid size-5 place-items-center pt-0.5">
              <StepIcon state={st.state} />
            </div>
            <div className="min-w-0">
              <div className={cn("text-[14px] font-medium", st.state === "pending" && "text-faint")}>{s.label}</div>
              <div className="text-[12.5px] text-muted">{st.detail ?? s.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProjectView({ project, status }: { project: Project; status: SourceStatus | null }) {
  const [tab, setTab] = useState<Tab>("papers");
  const [openPaper, setOpenPaper] = useState<string | null>(null);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const running = project.status === "running";
  const paper = project.papers.find((p) => p.id === openPaper) ?? null;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "papers", label: "Papers", icon: <FileSearch />, count: project.papers.length },
    { id: "gaps", label: "Gaps", icon: <Lightbulb /> },
    { id: "refs", label: "References", icon: <BookMarked />, count: project.refs.length },
    { id: "draft", label: "Draft check", icon: <ScanText /> },
    { id: "write", label: "Writing", icon: <PenLine /> },
  ];

  const failedSources = project.sources.filter((s) => !s.ok);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
      <header>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {project.draft && (
              <div className="mb-1.5 text-[12px] text-muted">
                From draft · <span className="font-medium">{project.draft.name}</span>
              </div>
            )}
            <h1 className="font-serif text-[28px] leading-tight tracking-tight sm:text-[34px]">
              {project.title || (running ? "Reading your idea…" : "Untitled research")}
            </h1>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runResearch(project.id)}
            disabled={running}
            icon={<RotateCw className={cn("size-3.5", running && "animate-spin")} />}
          >
            <span className="hidden sm:inline">Search again</span>
          </Button>
        </div>
        <button onClick={() => setIdeaOpen((v) => !v)} className="group mt-2 flex w-full items-start gap-1.5 text-left">
          <p className={cn("text-[14.5px] leading-relaxed text-muted", !ideaOpen && "line-clamp-2")}>{project.idea}</p>
          <ChevronDown className={cn("mt-1 size-4 shrink-0 text-faint transition", ideaOpen && "rotate-180")} />
        </button>
        {project.queries.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-faint">Searched for</span>
            {project.queries.map((q) => (
              <span key={q} className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] text-muted">
                {q}
              </span>
            ))}
          </div>
        )}
      </header>

      {(running || project.status === "error") && <Progress project={project} />}
      {project.status === "error" && project.error && (
        <Callout tone="bad" icon={<AlertTriangle />} className="mt-4">
          {project.error}
        </Callout>
      )}

      {running && project.papers.length === 0 && (
        <div className="mt-6 space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-5">
              <div className="skeleton h-5 w-3/4" />
              <div className="skeleton mt-2 h-3.5 w-1/2" />
              <div className="skeleton mt-4 h-3 w-full" />
              <div className="skeleton mt-1.5 h-3 w-11/12" />
            </div>
          ))}
        </div>
      )}

      {project.papers.length > 0 && (
        <>
          {!running && (project.steps.rank.state === "skipped" || failedSources.length > 0) && (
            <div className="mt-5 space-y-2">
              {project.steps.rank.state === "skipped" && (
                <Callout tone="warn" icon={<AlertTriangle />}>
                  AI ranking was skipped ({project.steps.rank.detail}). Results are ordered by keyword overlap.{" "}
                  {status?.ai && (
                    <button className="font-medium underline" onClick={() => runResearch(project.id)}>
                      Try again
                    </button>
                  )}
                </Callout>
              )}
              {failedSources.length > 0 && (
                <Callout icon={<AlertTriangle />}>
                  {failedSources.map((s) => SOURCE_NAMES[s.id]).join(", ")} did not respond this time (
                  {failedSources[0].error}). Results come from the other sources.
                </Callout>
              )}
            </div>
          )}

          <div className="sticky top-[57px] z-20 -mx-4 mt-6 border-b border-border bg-bg/90 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0">
            <nav className="scroll-thin -mb-px flex gap-1 overflow-x-auto" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "relative flex items-center gap-2 whitespace-nowrap px-3 py-3 text-[13.5px] font-medium transition [&>svg]:size-4",
                    tab === t.id ? "text-text" : "text-muted hover:text-text",
                  )}
                >
                  {t.icon}
                  {t.label}
                  {t.count ? (
                    <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums text-muted">{t.count}</span>
                  ) : null}
                  {tab === t.id && (
                    <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
                  )}
                </button>
              ))}
            </nav>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="pt-5"
            >
              {tab === "papers" && <PapersTab project={project} running={running} onOpen={setOpenPaper} />}
              {tab === "gaps" && <GapsTab project={project} ai={status?.ai ?? true} onOpen={setOpenPaper} />}
              {tab === "refs" && <ReferencesTab project={project} onBrowse={() => setTab("papers")} />}
              {tab === "draft" && <DraftTab project={project} onOpen={setOpenPaper} />}
              {tab === "write" && <WritingTab project={project} ai={status?.ai ?? true} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}

      <PaperDrawer project={project} paper={paper} onClose={() => setOpenPaper(null)} ai={status?.ai ?? true} />
    </div>
  );
}
