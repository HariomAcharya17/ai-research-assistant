// AI-writing check: splits a draft into chunks for two in-browser classifiers
// and combines their scores. Pure functions only, so they can be unit tested.

import { detectHeading } from "./passages";
import { sentences, words } from "./text";

/**
 * The two detectors, pinned to exact revisions so results cannot change under us.
 * Both are RoBERTa-base classifiers (about 125 MB each when quantised) that run in the browser.
 */
export const DETECTORS = [
  {
    key: "tmr",
    name: "TMR",
    repo: "onnx-community/tmr-ai-text-detector-ONNX",
    revision: "b9aa251e5bcda7e429fcc936767d921435945b60",
    about: "RoBERTa trained on the RAID benchmark (11 AI models, adversarial rewrites). Strong on edited AI text.",
    link: "https://huggingface.co/Oxidane/tmr-ai-text-detector",
  },
  {
    key: "fakespot",
    name: "Fakespot",
    repo: "hbhanushali/fakespot-ai-detector-onnx",
    revision: "e2fddfefe101446f4626061424e156c9058092e0",
    about: "Mozilla Fakespot's RoBERTa detector (Apache-2.0). Fewer false alarms on formal writing.",
    link: "https://huggingface.co/fakespot-ai/roberta-base-ai-text-detection-v1",
  },
] as const;

export type DetectorKey = (typeof DETECTORS)[number]["key"];

/** Both models must reach this for "likely AI". */
export const LIKELY_AI = 0.95;
/** One model at or above this, without agreement, gives "possibly AI". */
export const POSSIBLE_AI = 0.9;
/** Shorter chunks are not scored: the models are unreliable on short text. */
export const MIN_WORDS = 40;
const TARGET_WORDS = 200;
const MAX_WORDS = 320;
const SHORT_PARA = 80;

export type AiLevel = "likely-ai" | "possible-ai" | "likely-human" | "unscored";

export interface Chunk {
  id: number;
  /** Text as shown to the user. */
  text: string;
  /** Text sent to the models: markdown removed, quotations removed. */
  scoreText: string;
  words: number;
  quotedWords: number;
  /** Section heading this chunk sits under, if any. */
  heading?: string;
}

export interface Prepared {
  chunks: Chunk[];
  totalWords: number;
  referencesCut: boolean;
  likelyEnglish: boolean;
}

const HEADING_MAX_WORDS = 8;
const REFERENCES = /^\s*(?:\d+\.?\s*)?(references|bibliography|works cited|literature cited|reference list)\s*:?\s*$/im;
// Straight or curly double quotes around 5+ words.
const QUOTED = /["“]([^"“”]{20,}?)["”]/g;
const ENGLISH = new Set("the of and to in is that for it as was with be by on are this which from at an or have not their".split(" "));

/** Port of the cleaning step Fakespot recommends before scoring. */
export function cleanForModel(t: string): string {
  return t
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/<[^>]+>/g, "")
    .replace(/^#+\s/gm, "")
    .replace(/^\s*(?:[-*+•]|\d+\.)\s+/gm, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ ,/g, ",")
    .replace(/ {2,}/g, " ")
    .trim();
}

function isHeading(line: string): boolean {
  if (detectHeading(line)) return true;
  // Other short Title Case lines without end punctuation, e.g. "Data and Sampling".
  // Plain short lines are not enough: two-column PDFs wrap sentences into short lines.
  const w = line.split(/\s+/).filter(Boolean);
  if (!w.length || w.length > HEADING_MAX_WORDS || /[.!?,;:]["')\]]?$/.test(line) || !/^[A-Z0-9]/.test(line)) return false;
  const caps = w.filter((x) => /^[A-Z0-9]/.test(x) || /^(of|and|the|in|for|on|to|a|an|with|by|vs\.?)$/.test(x));
  return caps.length / w.length >= 0.8;
}

/** Split a draft into chunks of about 200 words that follow paragraph and heading boundaries. */
export function prepareChunks(input: string): Prepared {
  let text = input.replace(/\r\n?/g, "\n");
  const ref = REFERENCES.exec(text);
  // Only treat it as a reference list when it is in the second half of the document.
  const referencesCut = Boolean(ref && ref.index > text.length * 0.4);
  if (ref && referencesCut) text = text.slice(0, ref.index);

  // Rebuild paragraphs: PDF text often has one line per visual line.
  type Block = { kind: "heading"; text: string } | { kind: "para"; text: string };
  const blocks: Block[] = [];
  let para = "";
  const flushPara = () => {
    if (para.trim()) blocks.push({ kind: "para", text: para.trim() });
    para = "";
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      continue;
    }
    if (isHeading(line) && !para.endsWith("-")) {
      flushPara();
      blocks.push({ kind: "heading", text: line });
      continue;
    }
    if (para.endsWith("-")) para = para.slice(0, -1) + line;
    else para += (para ? " " : "") + line;
  }
  flushPara();

  const chunks: Chunk[] = [];
  let heading: string | undefined;
  let cur: string[] = []; // paragraphs of the current chunk
  let curWords = 0;
  const flush = () => {
    const shown = cur.join("\n\n").trim();
    cur = [];
    curWords = 0;
    if (!shown) return;
    let quotedWords = 0;
    const unquoted = shown.replace(QUOTED, (m) => {
      quotedWords += words(m).length;
      return " ";
    });
    const scoreText = cleanForModel(unquoted);
    chunks.push({ id: chunks.length, text: shown, scoreText, words: words(scoreText).length, quotedWords, heading });
  };

  for (const b of blocks) {
    if (b.kind === "heading") {
      flush();
      heading = b.text;
      continue;
    }
    const paraWords = words(b.text).length;
    // Paragraphs are the natural unit (people often mix their own and AI paragraphs),
    // so only merge when one side is too short to score well on its own.
    if (curWords && (curWords < SHORT_PARA || paraWords < SHORT_PARA) && curWords + paraWords <= TARGET_WORDS) {
      cur.push(b.text);
      curWords += paraWords;
      continue;
    }
    if (curWords) flush();
    if (paraWords <= MAX_WORDS) {
      cur.push(b.text);
      curWords = paraWords;
      continue;
    }
    // Long paragraph: cut at sentence ends near the target size.
    let piece = "";
    let pieceWords = 0;
    for (const s of sentences(b.text)) {
      const n = words(s.text).length;
      if (pieceWords >= TARGET_WORDS && pieceWords + n > TARGET_WORDS) {
        cur.push(piece.trim());
        flush();
        piece = "";
        pieceWords = 0;
      }
      piece += " " + s.text;
      pieceWords += n;
    }
    if (piece.trim()) {
      cur.push(piece.trim());
      curWords = pieceWords;
    }
  }
  flush();

  // Fold a short tail into the chunk before it when they share a heading, so it can be scored.
  for (let i = chunks.length - 1; i > 0; i--) {
    const a = chunks[i - 1];
    const b = chunks[i];
    if (b.words < MIN_WORDS && a.heading === b.heading && a.words + b.words <= MAX_WORDS) {
      chunks[i - 1] = {
        ...a,
        text: `${a.text}\n\n${b.text}`,
        scoreText: `${a.scoreText} ${b.scoreText}`.trim(),
        words: a.words + b.words,
        quotedWords: a.quotedWords + b.quotedWords,
      };
      chunks.splice(i, 1);
    }
  }
  chunks.forEach((c, i) => (c.id = i));

  const all = words(text);
  const english = all.length ? all.filter((w) => ENGLISH.has(w)).length / all.length : 0;
  return { chunks, totalWords: all.length, referencesCut, likelyEnglish: english >= 0.12 };
}

export type Scores = Record<DetectorKey, number>;

export function classify(scores: Scores | undefined, chunkWords: number): AiLevel {
  if (!scores || chunkWords < MIN_WORDS) return "unscored";
  const v = Object.values(scores);
  if (Math.min(...v) >= LIKELY_AI) return "likely-ai";
  if (Math.max(...v) >= POSSIBLE_AI) return "possible-ai";
  return "likely-human";
}

export interface AiReport {
  levels: AiLevel[];
  words: Record<AiLevel, number>;
  scoredWords: number;
  quotedWords: number;
  /** Shares of scored words, 0 to 100, one decimal. */
  share: { likelyAi: number; possibleAi: number; likelyHuman: number };
}

export function summarize(chunks: Chunk[], scores: (Scores | undefined)[]): AiReport {
  const levels = chunks.map((c, i) => classify(scores[i], c.words));
  const w: Record<AiLevel, number> = { "likely-ai": 0, "possible-ai": 0, "likely-human": 0, unscored: 0 };
  let quotedWords = 0;
  chunks.forEach((c, i) => {
    w[levels[i]] += c.words;
    quotedWords += c.quotedWords;
  });
  const scored = w["likely-ai"] + w["possible-ai"] + w["likely-human"];
  const p = (n: number) => (scored ? Math.round((n / scored) * 1000) / 10 : 0);
  return {
    levels,
    words: w,
    scoredWords: scored,
    quotedWords,
    share: { likelyAi: p(w["likely-ai"]), possibleAi: p(w["possible-ai"]), likelyHuman: p(w["likely-human"]) },
  };
}
