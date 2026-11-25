"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { del, get, set } from "idb-keyval";
import type { CitationStyle, Gaps, Paper, Passage, SearchFilters, SourceId, Summary } from "@/lib/types";

// Everything lives in the browser (IndexedDB). No account, no server database.

export type StepState = "pending" | "active" | "done" | "skipped" | "error";

export interface FullText {
  passages: Passage[];
  pages?: number;
  origin: "open-access" | "upload";
  via?: string;
  sourceUrl?: string;
}

export interface Project {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  idea: string;
  keywords: string[];
  queries: string[];
  filters: SearchFilters;
  draft?: { name: string; text: string };
  /** The project was started from an uploaded draft. */
  fromDraft?: boolean;
  status: "running" | "ready" | "error";
  error?: string;
  steps: Record<"plan" | "search" | "rank", { state: StepState; detail?: string }>;
  sources: { id: SourceId; ok: boolean; count: number; error?: string }[];
  total: number;
  papers: Paper[];
  fulltext: Record<string, FullText>;
  summaries: Record<string, Summary>;
  gaps?: Gaps;
  refs: string[];
  style: CitationStyle;
}

interface State {
  projects: Project[];
  activeId: string | null;
  hydrated: boolean;
  create: (p: Pick<Project, "idea" | "title" | "filters" | "draft">) => string;
  update: (id: string, patch: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
  remove: (id: string) => void;
  open: (id: string | null) => void;
}

const idbStorage: StateStorage = {
  getItem: async (name) => (await get<string>(name)) ?? null,
  setItem: async (name, value) => {
    await set(name, value);
  },
  removeItem: async (name) => {
    await del(name);
  },
};

const newId = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 12);

export const useStore = create<State>()(
  persist(
    (setState) => ({
      projects: [],
      activeId: null,
      hydrated: false,
      create: ({ idea, title, filters, draft }) => {
        const id = newId();
        const now = Date.now();
        const project: Project = {
          id,
          createdAt: now,
          updatedAt: now,
          title,
          idea,
          keywords: [],
          queries: [],
          filters,
          draft,
          fromDraft: Boolean(draft),
          status: "running",
          steps: { plan: { state: "pending" }, search: { state: "pending" }, rank: { state: "pending" } },
          sources: [],
          total: 0,
          papers: [],
          fulltext: {},
          summaries: {},
          refs: [],
          style: "apa",
        };
        setState((s) => ({ projects: [project, ...s.projects], activeId: id }));
        return id;
      },
      update: (id, patch) =>
        setState((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, ...(typeof patch === "function" ? patch(p) : patch), updatedAt: Date.now() } : p,
          ),
        })),
      remove: (id) =>
        setState((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        })),
      open: (id) => setState({ activeId: id }),
    }),
    {
      name: "research-desk",
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      // Rehydrated from App on mount, so nothing touches IndexedDB during prerender.
      skipHydration: true,
      partialize: (s) => ({ projects: s.projects, activeId: s.activeId }),
      onRehydrateStorage: () => (state) => {
        // A run cut off by a reload cannot resume, so mark it as stopped.
        state?.projects.forEach((p) => {
          if (p.status === "running") {
            p.status = p.papers.length ? "ready" : "error";
            if (!p.papers.length) p.error = "The search was interrupted. Run it again.";
          }
        });
        useStore.setState({ hydrated: true });
      },
    },
  ),
);

export const useActiveProject = () =>
  useStore((s) => s.projects.find((p) => p.id === s.activeId) ?? null);

export const getProject = (id: string) => useStore.getState().projects.find((p) => p.id === id);
