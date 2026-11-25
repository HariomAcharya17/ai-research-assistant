"use client";

import { BookOpenText, Menu, Moon, Plus, Sun, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Toaster } from "sonner";
import { useActiveProject, useStore } from "@/lib/client/store";
import type { SourceStatus } from "@/lib/types";
import { Home } from "./Home";
import { ProjectView } from "./ProjectView";
import { Button, cn, Spinner } from "./ui";

export function useSourceStatus() {
  const [status, setStatus] = useState<SourceStatus | null>(null);
  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);
  return status;
}

function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme ?? "light",
    () => "light",
  );
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
  };
  return (
    <button
      onClick={flip}
      aria-label="Toggle dark mode"
      className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-text"
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const projects = useStore((s) => s.projects);
  const activeId = useStore((s) => s.activeId);
  const open = useStore((s) => s.open);
  const remove = useStore((s) => s.remove);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <button onClick={() => (open(null), onNavigate?.())} className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-ink">
            <BookOpenText className="size-[18px]" />
          </span>
          <span className="font-serif text-[19px] font-medium tracking-tight">Research Desk</span>
        </button>
        <ThemeToggle />
      </div>
      <div className="px-3">
        <Button
          variant="secondary"
          className="w-full justify-start"
          icon={<Plus className="size-4" />}
          onClick={() => (open(null), onNavigate?.())}
        >
          New research
        </Button>
      </div>
      <div className="mt-5 px-4 text-[11px] font-semibold uppercase tracking-wider text-faint">Your research</div>
      <nav className="scroll-thin mt-1.5 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {projects.length === 0 && <p className="px-2 py-2 text-[13px] text-faint">Searches you run are saved here, in this browser.</p>}
        {projects.map((p) => (
          <div
            key={p.id}
            className={cn(
              "group flex items-center rounded-lg pr-1 transition",
              p.id === activeId ? "bg-surface-2" : "hover:bg-surface-2/60",
            )}
          >
            <button
              onClick={() => (open(p.id), onNavigate?.())}
              className="min-w-0 flex-1 px-2.5 py-2 text-left"
              title={p.title}
            >
              <div className={cn("truncate text-[13.5px]", p.id === activeId ? "font-medium text-text" : "text-muted")}>
                {p.title || "Untitled"}
              </div>
              <div className="flex items-center gap-1.5 text-[11.5px] text-faint">
                {p.status === "running" && <Spinner className="size-3" />}
                {p.papers.length ? `${p.papers.length} papers` : p.status === "error" ? "No results" : "Searching…"}
                <span>·</span>
                {new Date(p.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete "${p.title}"? This cannot be undone.`)) remove(p.id);
              }}
              aria-label={`Delete ${p.title}`}
              className="grid size-7 place-items-center rounded-md text-faint opacity-0 transition hover:bg-bad-soft hover:text-bad group-hover:opacity-100 focus:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </nav>
      <div className="border-t border-border px-4 py-3 text-[11.5px] leading-relaxed text-faint">
        Free and open sources. Your work stays in this browser.
      </div>
    </div>
  );
}

export function App() {
  const hydrated = useStore((s) => s.hydrated);
  const project = useActiveProject();
  const [menu, setMenu] = useState(false);
  const status = useSourceStatus();
  useEffect(() => {
    const done = () => useStore.setState({ hydrated: true });
    // If IndexedDB is blocked (some private windows), start with an empty workspace.
    const t = setTimeout(done, 2500);
    Promise.resolve(useStore.persist.rehydrate())
      .catch(() => {})
      .finally(() => {
        clearTimeout(t);
        done();
      });
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex min-h-dvh">
      <Toaster position="bottom-right" richColors closeButton />
      <aside className="sticky top-0 hidden h-dvh w-[268px] shrink-0 border-r border-border bg-surface/60 lg:block">
        <Sidebar />
      </aside>

      <AnimatePresence>
        {menu && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/30 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMenu(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-[280px] border-r border-border bg-surface lg:hidden"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
            >
              <button
                onClick={() => setMenu(false)}
                aria-label="Close menu"
                className="absolute right-3 top-14 grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2"
              >
                <X className="size-4" />
              </button>
              <Sidebar onNavigate={() => setMenu(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-bg/85 px-4 py-2.5 backdrop-blur lg:hidden">
          <button
            onClick={() => setMenu(true)}
            aria-label="Open menu"
            className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2"
          >
            <Menu className="size-5" />
          </button>
          <span className="font-serif text-lg">Research Desk</span>
        </div>
        {!hydrated ? (
          <div className="grid h-[70vh] place-items-center">
            <Spinner className="size-6" />
          </div>
        ) : project ? (
          <ProjectView key={project.id} project={project} status={status} />
        ) : (
          <Home status={status} />
        )}
      </main>
    </div>
  );
}
