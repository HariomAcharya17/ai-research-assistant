# Research Desk: How It Works

A short guide to what the app does and how a request flows through it. For setup and deployment, see `README.md`.

## In one sentence

You describe a research idea (or upload a draft), and the app searches 10+ free scholarly sources worldwide, ranks the papers, explains them with links back to the text, finds research gaps, builds verified citations and checks your draft for overlapping wording.

## The user flow

```
 Home ──► Start a project
           │  type an idea  ─or─  upload a draft (PDF / DOCX)
           ▼
 ┌─────────────── Research pipeline (runs automatically) ───────────────┐
 │ 1. Plan     AI turns the idea into search queries + keywords          │
 │ 2. Search   all sources queried in parallel, merged, de-duplicated    │
 │ 3. Rank     BM25 keyword score, then AI rubric score (0–100) + reason │
 └───────────────────────────────────────────────────────────────────────┘
           ▼
 Project workspace (five tabs)
   Papers ─► open a paper ─► full text ─► AI explanation linked to passages
   Gaps   ─► pick 2+ papers ─► author-stated limitations + AI suggestions
   References ─► APA / IEEE / MLA / Chicago / Harvard / Vancouver / BibTeX
   Draft  ─► similarity check of your draft against loaded sources
   Writing ─► grammar, clarity, structure, cited paraphrase (with diff)
```

Projects are saved in your browser (IndexedDB). There is no account and no server database.

## Step by step

### 1. Start a project

- **From an idea:** type a few sentences about your research. Optional filters: year range, open access only.
- **From a draft:** upload a PDF or DOCX. The file is read in the browser. `/api/draft` turns the opening pages into a title, a short idea and keywords, and the search starts from that.

### 2. Plan (`/api/plan`)

The AI writes several search queries from the idea. If the idea is not in English, it adds one query in that language. Without AI, the app builds two keyword queries instead.

### 3. Search (`/api/search`)

All sources are searched in parallel:

| Source | Coverage | Key |
| --- | --- | --- |
| OpenAlex | 250M+ works, all fields and countries | none |
| Crossref | 160M+ DOI records, 20,000+ publishers | none |
| Europe PMC | PubMed, PubMed Central, bioRxiv/medRxiv | none |
| Semantic Scholar | 200M+ papers | optional (avoids rate limits) |
| arXiv | physics, maths, CS, statistics, economics | none |
| DOAJ | open-access journals, 130 countries | none |
| HAL | French and European archive | none |
| ERIC | education research | none |
| INSPIRE-HEP | high-energy physics | none |
| J-STAGE | Japanese journals | none |
| CORE | 300M+ open-access papers | free key |
| Springer Nature | direct publisher search | free key |
| IEEE Xplore | direct publisher search | free key |

Then the app:

1. Merges duplicates by DOI, then by title. A published version wins over its preprint.
2. Scores every paper with BM25 keyword overlap against the idea.
3. Fills missing abstracts from Semantic Scholar.
4. Drops weak matches and keeps up to 50 papers.
5. Reports how many papers each source returned, and why any source failed.

Google Scholar has no public API, so each paper links to it instead.

### 4. Rank (`/api/rank`)

The AI scores the top 24 papers against the idea on a fixed 0–100 rubric. Each score comes with a one-line reason and the aspects that match. Scores are shown as a relevance ranking, not as a similarity percentage. Without AI, the keyword order is kept.

### 5. Read and explain a paper (`/api/fulltext`, `/api/explain`)

Opening a paper shows its details: title, authors, year, venue, publisher label, DOI, open-access and preprint status, indexing labels and links.

To read the paper, the app looks for a legal open copy in this order:

1. PubMed Central structured XML
2. The open-access PDF link
3. The arXiv version
4. OpenAlex open-access locations (by DOI)
5. Unpaywall (when `CONTACT_EMAIL` is set)

If none works, you can upload a PDF you have access to. The text is split into numbered passages by section and page.

The explanation covers the research question, methods, findings and limitations. Every point links to the passage it came from. The server removes any link to a passage that does not exist. If no full text is available, the explanation uses the abstract and says so.

### 6. Research gaps (`/api/gaps`)

Pick two or more papers. The app returns:

- **Author-stated limitations,** each with an exact quote. The server checks every quote word for word against the paper text and removes quotes that do not match.
- **AI-suggested questions,** shown separately and labelled as AI suggestions.

### 7. References (`/api/cite`)

Add papers to the reference list from the Papers tab. Citations are formatted from the official DOI record (Crossref/DataCite) and marked **verified**. Papers without a DOI are formatted from search data and marked **unverified**. Styles: APA, IEEE, MLA, Chicago, Harvard, Vancouver, plus BibTeX export.

### 8. Draft similarity check (runs in the browser)

Paste or upload your draft. Each sentence is compared with the abstracts and full texts loaded in the project, using word 5-gram overlap:

- **Strong** match: 50% or more overlap
- **Partial** match: 20% or more overlap
- **Quoted** text is counted separately

Each match shows the source passage next to your sentence. This is a check against the sources the app can access. It is not a plagiarism guarantee.

### 9. Writing help (`/api/write`)

Grammar, clarity, structure and paraphrasing, with a word-level diff of the changes. Paraphrasing needs a source and keeps the citation. The prompts forbid inventing facts or references, and the tool does not disguise copied text.

## What works without an AI key

| Feature | Without `GROQ_API_KEY` | With it |
| --- | --- | --- |
| Search all sources | yes | yes, with better queries |
| Ranking | keyword (BM25) | AI rubric score with reasons |
| Full text and uploads | yes | yes |
| Paper explanation | no | yes |
| Research gaps | no | yes |
| Citations | yes | yes |
| Draft similarity check | yes | yes |
| Writing help | no | yes |
| Start from a draft | basic (title and abstract) | AI summary of the draft |

## How the AI is kept honest

- The AI uses Groq's free tier (`gpt-oss-120b`, `gpt-oss-20b`, `qwen3-32b`). If one model is busy, the next one is tried.
- Every AI answer must match a fixed schema, or it is retried.
- Summary links to passages that don't exist are removed on the server.
- Gap quotes that do not appear in the paper are removed on the server.
- AI suggestions are always labelled separately from what the authors wrote.
- Scopus status is shown only when it was checked with an Elsevier key. Otherwise it says "unchecked" rather than guessing.

## Where things live

```
src/app/api/            One route per step: plan, search, rank, fulltext, explain,
                        gaps, cite, write, draft, status
src/lib/server/sources/ One adapter per scholarly source, plus merging
src/lib/server/         Groq client, full-text finder, request checks and rate limit
src/lib/client/         Browser store, research pipeline, file reading
src/lib/                Text tools, passage splitting, similarity check, citation helpers
src/components/         Home screen, project view and the five tabs
```

## Limits

- Full text is available only for open-access papers or PDFs you upload.
- Some repositories (for example HAL) block automated downloads. The app asks you to upload the PDF instead.
- Semantic Scholar is often busy without a free key. The other sources cover the gap.
- Groq's free tier has per-minute limits. When they are hit, the app falls back to another model or to keyword ranking.
- The similarity check sees only the sources loaded in the project.
