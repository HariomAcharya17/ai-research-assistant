"use client";

import { toast } from "sonner";
import type { Gaps, Paper, Passage, Relevance, SourceId, Summary } from "@/lib/types";
import { post } from "./api";
import { getProject, useStore, type FullText, type Project } from "./store";

const update = (id: string, patch: Partial<Project> | ((p: Project) => Partial<Project>)) =>
  useStore.getState().update(id, patch);

const setStep = (id: string, step: keyof Project["steps"], state: Project["steps"]["plan"]["state"], detail?: string) =>
  update(id, (p) => ({ steps: { ...p.steps, [step]: { state, detail } } }));

const level = (score: number): Relevance["level"] => (score >= 70 ? "high" : score >= 40 ? "medium" : "low");

/** Full pipeline: plan queries, search the sources, then rank with AI. */
export async function runResearch(id: string) {
  const project = getProject(id);
  if (!project) return;
  update(id, {
    status: "running",
    error: undefined,
    steps: { plan: { state: "active" }, search: { state: "pending" }, rank: { state: "pending" } },
  });

  try {
    const plan = await post<{ title: string; queries: string[]; keywords: string[]; ai: boolean }>("/api/plan", {
      idea: project.idea,
    });
    update(id, (p) => ({
      title: p.title || plan.title,
      queries: plan.queries,
      keywords: plan.keywords,
    }));
    setStep(id, "plan", "done", plan.ai ? `${plan.queries.length} searches planned` : "Keyword search (AI off)");

    setStep(id, "search", "active");
    const found = await post<{
      papers: Paper[];
      sources: { id: SourceId; ok: boolean; count: number; error?: string }[];
      total: number;
    }>("/api/search", { idea: project.idea, queries: plan.queries, keywords: plan.keywords, filters: project.filters });
    update(id, { papers: found.papers, sources: found.sources, total: found.total });
    if (!found.papers.length) {
      setStep(id, "search", "error", "No papers found");
      setStep(id, "rank", "skipped");
      update(id, { status: "error", error: "No papers matched. Try broader wording or remove filters." });
      return;
    }
    setStep(id, "search", "done", `${found.total} papers from ${found.sources.filter((s) => s.ok).length} sources`);

    setStep(id, "rank", "active");
    try {
      const top = found.papers.slice(0, 24);
      const { ranks } = await post<{ ranks: { id: string; score: number; why: string; aspects: string[] }[] }>(
        "/api/rank",
        { idea: project.idea, papers: top.map((p) => ({ id: p.id, title: p.title, year: p.year, abstract: p.abstract })) },
      );
      const byId = new Map(ranks.map((r) => [r.id, r]));
      const papers = found.papers
        .map((p) => {
          const r = byId.get(p.id);
          return r
            ? { ...p, relevance: { score: r.score, level: level(r.score), why: r.why, aspects: r.aspects, method: "ai" as const } }
            : p;
        })
        .sort((a, b) => {
          // AI-ranked papers first, by rubric score; the rest keep keyword order.
          const am = a.relevance?.method === "ai" ? 1 : 0;
          const bm = b.relevance?.method === "ai" ? 1 : 0;
          if (am !== bm) return bm - am;
          return (b.relevance?.score ?? 0) - (a.relevance?.score ?? 0) || (b.lexical ?? 0) - (a.lexical ?? 0);
        });
      update(id, { papers });
      setStep(id, "rank", "done", `${ranks.length} papers scored and explained`);
    } catch (e) {
      setStep(id, "rank", "skipped", e instanceof Error ? e.message : "AI ranking unavailable");
    }
    update(id, { status: "ready" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong";
    update(id, (p) => {
      const steps = { ...p.steps };
      for (const k of ["plan", "search", "rank"] as const) if (steps[k].state === "active") steps[k] = { state: "error", detail: msg };
      return { steps, status: p.papers.length ? "ready" : "error", error: msg };
    });
  }
}

export async function loadFullText(projectId: string, paper: Paper): Promise<FullText | null> {
  const existing = getProject(projectId)?.fulltext[paper.id];
  if (existing) return existing;
  if (!paper.pdfUrl) return null;
  const res = await post<{ passages: Passage[]; pages: number }>("/api/fulltext", { url: paper.pdfUrl });
  const ft: FullText = { passages: res.passages, pages: res.pages, origin: "open-access" };
  update(projectId, (p) => ({ fulltext: { ...p.fulltext, [paper.id]: ft } }));
  return ft;
}

export function saveUploadedFullText(projectId: string, paperId: string, passages: Passage[], pages: number) {
  update(projectId, (p) => ({ fulltext: { ...p.fulltext, [paperId]: { passages, pages, origin: "upload" } } }));
}

export async function explainPaper(projectId: string, paper: Paper, useFullText: boolean): Promise<Summary> {
  let passages: Passage[] | undefined;
  if (useFullText) {
    const ft = getProject(projectId)?.fulltext[paper.id] ?? (await loadFullText(projectId, paper));
    passages = ft?.passages;
  }
  const { summary } = await post<{ summary: Summary }>("/api/explain", {
    paper: { id: paper.id, title: paper.title, authors: paper.authors, year: paper.year, abstract: paper.abstract, doi: paper.doi, venue: paper.venue },
    passages,
  });
  update(projectId, (p) => ({ summaries: { ...p.summaries, [paper.id]: summary } }));
  return summary;
}

/** Text for gap analysis: stated limitations and conclusions when the full text is loaded, else the abstract. */
function gapText(project: Project, paper: Paper): { text: string; basis: "fulltext" | "abstract" } | null {
  const ft = project.fulltext[paper.id];
  if (ft) {
    const parts = ft.passages.filter((p) => /limitation|threat|future|conclu|discussion|abstract/i.test(p.section));
    const text = (parts.length ? parts : ft.passages.slice(0, 4)).map((p) => p.text).join("\n").slice(0, 6000);
    if (text) return { text, basis: "fulltext" };
  }
  return paper.abstract ? { text: paper.abstract, basis: "abstract" } : null;
}

export async function findGaps(projectId: string, paperIds: string[]): Promise<{ gaps: Gaps; dropped: number }> {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");
  const papers = paperIds
    .map((pid) => project.papers.find((p) => p.id === pid))
    .filter((p): p is Paper => Boolean(p))
    .map((p) => ({ p, t: gapText(project, p) }))
    .filter((x): x is { p: Paper; t: { text: string; basis: "fulltext" | "abstract" } } => x.t !== null)
    .map(({ p, t }) => ({ id: p.id, title: p.title, year: p.year, ...t }));
  if (papers.length < 2) throw new Error("Pick at least two papers that have an abstract or full text.");
  const res = await post<{ gaps: Gaps; droppedUnverified: number }>("/api/gaps", { idea: project.idea, papers });
  update(projectId, { gaps: res.gaps });
  return { gaps: res.gaps, dropped: res.droppedUnverified };
}

export function toggleRef(projectId: string, paperId: string) {
  update(projectId, (p) => {
    const on = p.refs.includes(paperId);
    if (!on) toast.success("Added to references");
    return { refs: on ? p.refs.filter((r) => r !== paperId) : [...p.refs, paperId] };
  });
}
