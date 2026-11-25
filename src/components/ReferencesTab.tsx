"use client";

import { AlertTriangle, BadgeCheck, BookMarked, Copy, Download, GripVertical, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { post } from "@/lib/client/api";
import { useStore, type Project } from "@/lib/client/store";
import { CITATION_STYLES, type CitationStyle } from "@/lib/types";
import { Badge, Button, Callout, copyText, download, Empty } from "./ui";

interface Citation {
  id: string;
  text: string;
  verified: boolean;
}

const cache = new Map<string, Citation>();

function toPlain(html: string) {
  return html.replace(/<[^>]+>/g, "");
}

/** Allow only the italics/bold/sup/sub markup that citation styles emit. */
function safeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;(\/?)(i|b|sup|sub)&gt;/g, "<$1$2>");
}

export function ReferencesTab({ project, onBrowse }: { project: Project; onBrowse: () => void }) {
  const update = useStore((s) => s.update);
  const style = project.style;
  const papers = project.refs.map((id) => project.papers.find((p) => p.id === id)).filter((p) => p !== undefined);
  const numeric = style === "ieee" || style === "vancouver";
  const key = `${style}|${project.refs.join("|")}`;
  const [done, setDone] = useState<{ key: string; error?: string } | null>(null);

  // Citations live in a module cache, so they are read during render.
  const cites: Record<string, Citation> = {};
  for (const p of papers) {
    const c = cache.get(`${style}|${p.id}`);
    if (c) cites[p.id] = c;
  }
  const allCached = papers.every((p) => cites[p.id]);
  const loading = !allCached && done?.key !== key;
  const error = done?.key === key ? (done.error ?? null) : null;

  useEffect(() => {
    const need = papers.filter((p) => !cache.has(`${style}|${p.id}`));
    if (!need.length) return;
    let cancelled = false;
    post<{ citations: Citation[] }>("/api/cite", {
      style,
      items: need.map((p) => ({ id: p.id, doi: p.doi, title: p.title, authors: p.authors, year: p.year, venue: p.venue, url: p.url })),
    })
      .then(({ citations }) => {
        citations.forEach((c) => cache.set(`${style}|${c.id}`, c));
        if (!cancelled) setDone({ key });
      })
      .catch((e: Error) => !cancelled && setDone({ key, error: e.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Numeric styles number by order in the list; author-date styles sort alphabetically.
  const ordered = numeric
    ? papers
    : [...papers].sort((a, b) => toPlain(cites[a.id]?.text ?? a.title).localeCompare(toPlain(cites[b.id]?.text ?? b.title)));

  const strip = (t: string) => t.replace(/^\s*\[\d+\]\s*/, "");
  const lines = ordered.map((p, i) => {
    const t = toPlain(cites[p.id]?.text ?? "");
    return numeric ? `[${i + 1}] ${strip(t)}` : t;
  });

  const exportBib = async () => {
    try {
      const { citations } = await post<{ citations: Citation[] }>("/api/cite", {
        style: "bibtex",
        items: papers.map((p) => ({ id: p.id, doi: p.doi, title: p.title, authors: p.authors, year: p.year, venue: p.venue, url: p.url })),
      });
      download("references.bib", citations.map((c) => c.text).join("\n\n"), "application/x-bibtex");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= project.refs.length) return;
    const refs = [...project.refs];
    const [x] = refs.splice(from, 1);
    refs.splice(to, 0, x);
    update(project.id, { refs });
  };

  if (!papers.length)
    return (
      <Empty icon={<BookMarked className="size-5" />} title="No references yet">
        Press <b>Cite</b> on any paper to add it here. References are built from the publisher&apos;s DOI record.
        <div className="mt-4">
          <Button variant="secondary" onClick={onBrowse}>
            Browse papers
          </Button>
        </div>
      </Empty>
    );

  const unverified = ordered.filter((p) => cites[p.id] && !cites[p.id].verified).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <select
          value={style}
          onChange={(e) => update(project.id, { style: e.target.value as CitationStyle })}
          className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[13.5px]"
          aria-label="Citation style"
        >
          {CITATION_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy className="size-3.5" />}
            disabled={loading}
            onClick={async () => ((await copyText(lines.join("\n\n"))) ? toast.success("Reference list copied") : toast.error("Copy failed"))}
          >
            Copy all
          </Button>
          <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />} disabled={loading} onClick={() => download("references.txt", lines.join("\n\n"))}>
            .txt
          </Button>
          <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />} onClick={exportBib}>
            BibTeX
          </Button>
        </div>
      </div>

      {error && (
        <Callout tone="bad" icon={<AlertTriangle />} className="mb-3">
          {error}
        </Callout>
      )}
      {unverified > 0 && (
        <Callout tone="warn" icon={<AlertTriangle />} className="mb-3">
          {unverified} reference{unverified > 1 ? "s have" : " has"} no DOI record, so {unverified > 1 ? "they were" : "it was"} formatted
          from search metadata. Check {unverified > 1 ? "them" : "it"} against the publisher page.
        </Callout>
      )}

      <ol className="space-y-2">
        {ordered.map((p, i) => {
          const c = cites[p.id];
          const idx = project.refs.indexOf(p.id);
          return (
            <li key={p.id} className="group flex gap-3 rounded-xl border border-border bg-surface p-3.5">
              {numeric ? (
                <div className="flex flex-col items-center">
                  <button aria-label="Move up" onClick={() => move(idx, idx - 1)} className="text-faint hover:text-text">
                    <GripVertical className="size-4" />
                  </button>
                  <span className="text-[13px] font-semibold tabular-nums text-muted">[{i + 1}]</span>
                </div>
              ) : null}
              <div className="min-w-0 flex-1">
                {c ? (
                  <p
                    className="font-serif text-[15px] leading-relaxed [overflow-wrap:anywhere]"
                    dangerouslySetInnerHTML={{ __html: safeHtml(numeric ? strip(c.text) : c.text) }}
                  />
                ) : (
                  <div className="space-y-1.5">
                    <div className="skeleton h-3.5 w-full" />
                    <div className="skeleton h-3.5 w-2/3" />
                  </div>
                )}
                {c && (
                  <div className="mt-2 flex items-center gap-2">
                    {c.verified ? (
                      <Badge tone="good" title="Formatted from the DOI registration record (Crossref or DataCite)">
                        <BadgeCheck className="size-3" /> Verified via DOI
                      </Badge>
                    ) : (
                      <Badge tone="warn">Unverified: no DOI record</Badge>
                    )}
                    <button
                      onClick={async () => ((await copyText(toPlain(c.text))) ? toast.success("Copied") : toast.error("Copy failed"))}
                      className="text-[12px] text-muted opacity-0 transition hover:text-text group-hover:opacity-100 focus:opacity-100"
                    >
                      Copy
                    </button>
                  </div>
                )}
              </div>
              <button
                aria-label="Remove reference"
                onClick={() => update(project.id, { refs: project.refs.filter((r) => r !== p.id) })}
                className="grid size-7 shrink-0 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-text"
              >
                <X className="size-4" />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
