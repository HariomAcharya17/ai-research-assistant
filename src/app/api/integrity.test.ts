import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as explain } from "./explain/route";
import { POST as gaps } from "./gaps/route";

const groqReturns = (obj: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }))));
const req = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": Math.random().toString() } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("integrity checks on AI output", () => {
  it("gaps: keeps only quotes that really appear in the paper", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    groqReturns({
      stated: [
        { n: 1, limitation: "Single site", quote: "our data come from a single hospital in one country" },
        { n: 2, limitation: "Invented", quote: "this sentence does not exist in the paper at all" },
      ],
      suggested: [{ question: "Multi-site?", rationale: "r", buildsOn: [1, 9] }],
    });
    const res = await gaps(
      req({
        idea: "Federated learning across hospitals",
        papers: [
          { id: "a", title: "A", basis: "abstract", text: "Results are strong. However, our data come from a single hospital in one country." },
          { id: "b", title: "B", basis: "abstract", text: "We propose a new model and it works well." },
        ],
      }),
    );
    const body = await res.json();
    expect(body.gaps.stated).toHaveLength(1);
    expect(body.gaps.stated[0].paperId).toBe("a");
    expect(body.droppedUnverified).toBe(1);
    expect(body.gaps.suggested[0].buildsOn).toEqual(["a"]);
  });

  it("explain: drops references to passages that were not given", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    groqReturns({
      researchQuestion: { text: "Q", refs: ["p1", "p99"] },
      methods: [{ text: "M", refs: ["p2"] }],
      findings: [],
      limitations: [{ text: "Unsupported limitation", refs: ["p77"] }],
    });
    const res = await explain(
      req({
        paper: { id: "x", title: "T", authors: [] },
        passages: [
          { id: "p1", section: "Introduction", text: "We ask whether federated learning helps small clinics." },
          { id: "p2", section: "Methods", text: "We trained a model across five hospitals." },
        ],
      }),
    );
    const { summary } = await res.json();
    expect(summary.basis).toBe("fulltext");
    expect(summary.researchQuestion.refs).toEqual(["p1"]);
    expect(summary.limitations).toEqual([]);
  });
});
