"use client";

import { AlertTriangle, FileUp, Info, Library, ScanText, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ACCEPT, readDocument } from "@/lib/client/files";
import { canFetchFullText, loadFullText } from "@/lib/client/research";
import { useStore, type Project } from "@/lib/client/store";
import { checkSimilarity, type SentenceResult, type SimilarityReport, type SourceDoc } from "@/lib/similarity";
import { Badge, Button, Callout, Card, cn } from "./ui";

function buildDocs(project: Project): SourceDoc[] {
  const docs: SourceDoc[] = [];
  for (const p of project.papers) {
    const ft = project.fulltext[p.id];
    if (ft) for (const ps of ft.passages) docs.push({ paperId: p.id, title: p.title, kind: "fulltext", passageId: ps.id, section: ps.section, text: ps.text });
    if (p.abstract) docs.push({ paperId: p.id, title: p.title, kind: "abstract", text: p.abstract });
  }
  return docs;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export function DraftTab({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const update = useStore((s) => s.update);
  const [paste, setPaste] = useState("");
  const [report, setReport] = useState<SimilarityReport | null>(null);
  const [selected, setSelected] = useState<SentenceResult | null>(null);
  const [loadingFT, setLoadingFT] = useState<{ done: number; total: number; failed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draft = project.draft;

  const oaMissing = useMemo(
    () => project.papers.filter((p) => canFetchFullText(p) && !project.fulltext[p.id]).slice(0, 10),
    [project.papers, project.fulltext],
  );
  const fullCount = Object.keys(project.fulltext).length;

  const setDraft = (name: string, text: string) => {
    update(project.id, { draft: { name, text } });
    setReport(null);
    setSelected(null);
  };

  const onFile = async (f: File) => {
    try {
      const text = (await readDocument(f)).trim();
      if (text.length < 100) throw new Error("Not enough text in the file.");
      setDraft(f.name, text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file");
    }
  };

  const run = () => {
    if (!draft) return;
    const r = checkSimilarity(draft.text, buildDocs(project));
    setReport(r);
    setSelected(r.sentences.find((s) => s.level === "strong") ?? r.sentences.find((s) => s.level === "partial") ?? null);
  };

  const loadTexts = async () => {
    const list = oaMissing;
    setLoadingFT({ done: 0, total: list.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      try {
        await loadFullText(project.id, list[i]);
      } catch {
        failed++;
      }
      setLoadingFT({ done: i + 1, total: list.length, failed });
    }
    setLoadingFT(null);
    toast.success(`Loaded ${list.length - failed} full texts${failed ? `, ${failed} could not be fetched` : ""}`);
    setReport(null);
  };

  if (!draft)
    return (
      <Card className="p-5">
        <h3 className="font-serif text-[20px]">Check your draft for overlapping wording</h3>
        <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-muted">
          Compares your text with the abstracts and full texts this project has loaded. It shows where your wording matches
          a source so you can quote or cite it. Your draft stays in this browser.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={6}
            placeholder="Paste your text here…"
            className="w-full resize-y rounded-lg border border-border bg-surface p-3 text-[14px] leading-relaxed outline-none placeholder:text-faint focus:border-accent"
          />
          <div className="flex flex-row gap-2 sm:flex-col">
            <Button variant="primary" disabled={paste.trim().length < 100} onClick={() => setDraft("Pasted text", paste.trim())}>
              Use this text
            </Button>
            <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => fileRef.current?.click()}>
              Upload file
            </Button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
      </Card>
    );

  const flaggedPct = report ? pct(report.strongWords + report.partialWords, report.totalWords) : 0;

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[12px] text-muted">Draft</div>
            <div className="truncate font-medium">{draft.name}</div>
            <div className="text-[12.5px] text-faint">{draft.text.split(/\s+/).length.toLocaleString()} words</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="size-3.5" />}
              onClick={() => {
                update(project.id, { draft: undefined });
                setReport(null);
              }}
            >
              Remove
            </Button>
            {oaMissing.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Library className="size-3.5" />}
                loading={Boolean(loadingFT)}
                onClick={loadTexts}
              >
                {loadingFT ? `Loading ${loadingFT.done}/${loadingFT.total}` : `Add ${oaMissing.length} open-access full texts`}
              </Button>
            )}
            <Button size="sm" variant="primary" icon={<ScanText className="size-3.5" />} onClick={run} disabled={Boolean(loadingFT)}>
              {report ? "Check again" : "Run similarity check"}
            </Button>
          </div>
        </div>
        <p className="mt-3 text-[12.5px] text-muted">
          Will compare against {project.papers.filter((p) => p.abstract).length} abstracts and {fullCount} full text
          {fullCount === 1 ? "" : "s"} from this project.
        </p>
      </Card>

      <Callout icon={<Info />}>
        This is a similarity check against sources the app can access, not a plagiarism verdict. It cannot see paywalled
        papers, the wider web or student-paper databases, and matching wording is fine when it is quoted and cited.
      </Callout>

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { l: "Matching wording", v: `${flaggedPct}%`, tone: flaggedPct > 15 ? "text-bad" : flaggedPct > 5 ? "text-warn" : "text-good" },
              { l: "Strong matches", v: `${pct(report.strongWords, report.totalWords)}%`, tone: "text-bad" },
              { l: "Partial matches", v: `${pct(report.partialWords, report.totalWords)}%`, tone: "text-warn" },
              { l: "Quoted matches", v: `${pct(report.quotedWords, report.totalWords)}%`, tone: "text-muted" },
            ].map((s) => (
              <Card key={s.l} className="p-3.5 shadow-none">
                <div className={cn("font-serif text-[28px] leading-none tabular-nums", s.tone)}>{s.v}</div>
                <div className="mt-1.5 text-[12px] text-muted">{s.l}</div>
              </Card>
            ))}
          </div>
          <p className="text-[12px] text-faint">
            Share of your words in sentences where ≥50% (strong) or ≥20% (partial) of 5-word sequences appear in one
            source. Checked {report.checked.abstracts} abstracts and {report.checked.fulltexts} full texts.
          </p>

          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <Card className="scroll-thin max-h-[640px] overflow-y-auto p-5 shadow-none">
              <div className="font-serif text-[15.5px] leading-[1.85]">
                {report.sentences.map((s, i) => (
                  <span key={i}>
                    <span
                      onClick={() => s.level !== "none" && setSelected(s)}
                      className={cn(
                        "rounded-sm transition",
                        s.level === "strong" && !s.quoted && "cursor-pointer bg-bad-soft decoration-bad underline decoration-2 underline-offset-4",
                        s.level === "partial" && !s.quoted && "cursor-pointer bg-warn-soft",
                        s.level !== "none" && s.quoted && "cursor-pointer bg-surface-2",
                        selected === s && "ring-2 ring-accent",
                      )}
                    >
                      {s.text}
                    </span>{" "}
                  </span>
                ))}
              </div>
            </Card>

            <div className="space-y-3 lg:sticky lg:top-16 lg:self-start">
              {selected?.match ? (
                <Card className="p-4 shadow-none">
                  <div className="flex items-center gap-2">
                    <Badge tone={selected.quoted ? "neutral" : selected.level === "strong" ? "bad" : "warn"}>
                      {selected.quoted ? "Quoted" : selected.level === "strong" ? "Strong match" : "Partial match"}
                    </Badge>
                    <span className="text-[12px] text-muted">{Math.round(selected.score * 100)}% of phrases</span>
                  </div>
                  <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">Your sentence</div>
                  <p className="mt-1 text-[13.5px] leading-relaxed">{selected.text}</p>
                  <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
                    Source {selected.match.kind === "fulltext" ? `· ${selected.match.section}` : "· abstract"}
                  </div>
                  <p className="mt-1 font-serif text-[14px] italic leading-relaxed text-muted">{selected.match.snippet}</p>
                  <button onClick={() => onOpen(selected.match!.paperId)} className="mt-2 text-left text-[12.5px] font-medium text-accent hover:underline">
                    {selected.match.title}
                  </button>
                  {!selected.quoted && (
                    <p className="mt-3 text-[12px] leading-relaxed text-faint">
                      Quote and cite this source, or rewrite in your own words and still cite it.
                    </p>
                  )}
                </Card>
              ) : (
                <Card className="p-4 text-[13px] text-muted shadow-none">
                  {report.strongWords + report.partialWords + report.quotedWords === 0
                    ? "No overlapping wording found in the sources checked."
                    : "Click a highlighted sentence to see the matching source."}
                </Card>
              )}
              {report.byPaper.length > 0 && (
                <Card className="p-4 shadow-none">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Matches by source</div>
                  <ul className="mt-2 space-y-2">
                    {report.byPaper.slice(0, 8).map((b) => (
                      <li key={b.paperId} className="flex items-start justify-between gap-3 text-[13px]">
                        <button onClick={() => onOpen(b.paperId)} className="line-clamp-2 text-left hover:text-accent">
                          {b.title}
                        </button>
                        <span className="shrink-0 tabular-nums text-muted">{pct(b.words, report.totalWords)}%</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
      {!report && fullCount === 0 && project.papers.length > 0 && (
        <Callout tone="warn" icon={<AlertTriangle />}>
          Only abstracts are loaded. Add open-access full texts for a deeper check.
        </Callout>
      )}
    </div>
  );
}
