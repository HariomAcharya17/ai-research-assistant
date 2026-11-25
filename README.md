# Research Desk

An AI research assistant. Describe a research idea or upload a draft paper, and Research Desk finds closely related papers, ranks and explains them, points out gaps, builds verified references and checks your draft for overlapping wording.

Everything it uses is free: open scholarly APIs, Groq's free AI tier and Vercel's free Hobby plan. There is no account or database. Your projects are saved in your own browser.

## Features

- **Search academic sources worldwide.** Every search runs in parallel across free scholarly indexes covering all fields and regions:
  - **OpenAlex**: 250M+ works from every field and country, including Springer, IEEE, Elsevier, Wiley, ACM and SciELO.
  - **Crossref**: 160M+ DOI records from 20,000+ publishers.
  - **Europe PMC**: all of PubMed and PubMed Central, plus bioRxiv/medRxiv preprints.
  - **Semantic Scholar**: 200M+ papers.
  - **arXiv**: physics, mathematics, CS, statistics, economics and biology preprints.
  - **DOAJ**: peer-reviewed open-access journals from 130 countries.
  - **HAL**: French and European research archive.
  - **ERIC**: education research.
  - **INSPIRE-HEP**: high-energy physics.
  - **J-STAGE**: Japanese journals.

  With free keys, it also searches **CORE** (300M+ open-access papers), the **Springer Nature API** and the **IEEE Xplore API** directly. Results are merged and de-duplicated by DOI and title. Each paper shows its title, authors, year, abstract, venue, publisher label, DOI, open-access and preprint status, which sources found it, and links to the DOI, publisher page, PDF and Google Scholar. Google Scholar has no public API, so the app links to it rather than scraping it. If the idea is written in another language, the AI adds a search in that language.
- **Rank related papers.** Results are first scored with BM25 keyword overlap. Then an AI rates the top 24 against your idea on a fixed 0–100 rubric and gives a one-line reason for each match. The UI calls this a relevance ranking and shows the rubric. It is not presented as a measured similarity percentage.
- **Read and explain papers.** The app finds a legal full text automatically. It tries structured PubMed Central XML, then the open-access PDF, the arXiv version, OpenAlex's open-access locations and (optionally) Unpaywall. The text is split into numbered passages by section and page. You can also upload a PDF you have access to. The summary covers the research question, methods, findings and author-stated limitations. Every point links to the passage it came from, and links to passages that don't exist are dropped on the server.
- **Identify research gaps.** Limitations the authors state are shown with an exact quote, which the server checks word for word against the paper text; quotes that don't match are removed. AI-suggested follow-up questions are shown separately and labelled as AI suggestions.
- **Citations.** References in APA, IEEE, MLA, Chicago, Harvard and Vancouver, plus BibTeX export. They are formatted from the DOI registration record (Crossref/DataCite) and marked as verified. Papers without a DOI are formatted from search metadata and marked as unverified.
- **Draft similarity check.** Compares each sentence of your draft with the abstracts and full texts the project has loaded, using word 5-gram overlap. It shows strong, partial and quoted matches next to the matching source passage. It is a similarity check against sources the app can access, not a guarantee that work is free of plagiarism.
- **AI writing check.** Estimates how much of a draft reads as AI-generated. Two open detection models (TMR, trained on the RAID benchmark, and Mozilla Fakespot's RoBERTa detector) run in the browser with Transformers.js, so the text never leaves the device. The draft is split into paragraph-sized chunks. Quotations and the reference list are left out, and chunks under 40 words are not scored. A chunk is marked likely AI only when both models score it at 95% or more, and possibly AI when one model reaches 90%. Each chunk shows both scores. The models (about 250 MB) download once and are cached. No detector is fully accurate: in our test, 2 of 25 human-written pre-ChatGPT abstracts were marked likely AI. The app says so and presents the result as an estimate, not proof.
- **Responsible writing help.** Grammar, clarity, structure, and cited paraphrasing with a word-level diff. The prompts forbid inventing facts or citations, and the tool is not designed to disguise copied text or evade plagiarism detection.
- **Indexing labels.** Papers are labelled by publisher and source. DOAJ listing comes from OpenAlex. With a free Elsevier key, journal ISSNs are checked against Scopus. Otherwise Scopus status is left unchecked instead of being guessed.

## Tech stack

- Next.js 16 (App Router, Route Handlers), React 19 and TypeScript
- Tailwind CSS v4, Motion, lucide-react and sonner
- Zustand with IndexedDB persistence (idb-keyval), so all user data stays in the browser
- Zod for request validation and structured AI output
- Groq (`openai/gpt-oss-120b` and `gpt-oss-20b`, with fallbacks) for AI features
- Transformers.js (ONNX Runtime Web) for the in-browser AI writing detectors
- unpdf for PDF text (on the server for open-access PDFs, in the browser for uploads), mammoth for DOCX, and diff for revision views
- Vitest for unit tests

## Run locally

```bash
npm install
cp .env.example .env.local   # add your free GROQ_API_KEY
npm run dev                  # http://localhost:3000
```

Without `GROQ_API_KEY`, the app still searches, ranks by keywords, builds citations and runs the draft check. AI ranking, explanations, gaps and writing help turn on once the key is set.

Other scripts: `npm test`, `npm run lint`, `npm run build`.

## Environment variables

| Variable | Needed | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | For AI features | Free key from console.groq.com |
| `OPENALEX_API_KEY` | Optional | Raises OpenAlex's free daily quota |
| `SEMANTIC_SCHOLAR_API_KEY` | Optional | Avoids the shared rate limit |
| `CORE_API_KEY` | Optional | Search CORE's 300M+ open-access papers |
| `SPRINGER_API_KEY` | Optional | Direct Springer Nature search |
| `IEEE_API_KEY` | Optional | Direct IEEE Xplore search |
| `ELSEVIER_API_KEY` | Optional | Scopus indexing check for journals |
| `CONTACT_EMAIL` | Optional | Turns on Unpaywall lookups and Crossref's polite pool |
| `AI_REQUESTS_PER_10_MIN` | Optional | Per-IP limit on AI requests (default 60) |

## Deploy for free

1. Import the GitHub repository at vercel.com/new (Hobby plan).
2. Add `GROQ_API_KEY`, and any optional keys, under Environment Variables.
3. Deploy. No database or other services are needed.

## Project structure

```
src/
  app/api/        plan, search, rank, fulltext, explain, gaps, cite, write, draft, status
  components/     App shell, Home, ProjectView and the five workspace tabs
  lib/server/     Groq client, full-text finder, request helpers
  lib/server/sources/  One adapter per scholarly source, merging and the source registry
  lib/client/     Store, research pipeline, file reading
  lib/            Shared text tools, passage splitting, similarity check, citation helpers
```

## Limits to know

- Full text is available only for open-access papers or PDFs you upload. Some repositories (for example HAL and PubMed Central's PDF links) block automated downloads. The app says so and asks you to upload the file instead.
- Semantic Scholar's keyless pool is shared and often busy. A free key fixes this, and the other sources cover the gap meanwhile.
- Groq's free tier has per-minute token limits. When they are hit, the app falls back to another model or to keyword ranking and tells you.
- The similarity check only sees the sources loaded in the project. It does not search the web or student-paper databases.
- The AI writing check is an estimate. Formal human writing is sometimes flagged, heavily rewritten AI text can pass, and it is reliable only for English.
