import assert from "node:assert/strict";
import test from "node:test";
import { judgeEmojiRelevance } from "./jev";

const candidates = [
  { name: "calendar", aliases: [] },
  { name: "facepalm", aliases: ["exasperated"] },
  { name: "eye_roll", aliases: [] },
];

test("Jev can accept multiple candidates and orders them by yes probability", async () => {
  let requests = 0;
  const result = await judgeEmojiRelevance(
    "another pointless meeting",
    candidates,
    {
      apiKey: "test-key",
      fetch: async (url, init) => {
        requests++;
        assert.equal(url, "https://api.typesafe.ai/v1/systemone");
        assert.equal(init?.method, "POST");
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          "Bearer test-key",
        );
        assert.equal(typeof init?.body, "string");
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body.state, { query: "another pointless meeting" });
        assert.equal(body.questions.c1.type, "noul");
        assert.match(body.questions.c1.instructions, /facepalm.*exasperated/);
        return Response.json({
          answers: {
            c2: { type: "noul", noul: 0.94 },
            c0: { type: "noul", noul: 0.69 },
            c1: { type: "noul", noul: 0.7 },
          },
        });
      },
    },
  );
  assert.equal(requests, 1);
  assert.deepEqual(result, ["eye_roll", "facepalm"]);
});

test("a successful no-match decision is not an API failure", async () => {
  const [candidate] = candidates;
  assert.deepEqual(
    await judgeEmojiRelevance("ship it", [candidate], {
      apiKey: "test-key",
      fetch: async () =>
        Response.json({ answers: { c0: { type: "noul", noul: 0.1 } } }),
    }),
    [],
  );
});

test("missing and out-of-range decisions are rejected instead of treated as no matches", async () => {
  for (const answers of [{}, { c0: { type: "noul", noul: 1.1 } }]) {
    await assert.rejects(
      judgeEmojiRelevance("ship it", [candidates[0]], {
        apiKey: "test-key",
        fetch: async () => Response.json({ answers }),
      }),
      /invalid relevance decision/i,
    );
  }
});

test("a rate limit produces an actionable error without retrying", async () => {
  let requests = 0;
  await assert.rejects(
    judgeEmojiRelevance("ship it", candidates, {
      apiKey: "test-key",
      fetch: async () => {
        requests++;
        return new Response(null, { status: 429 });
      },
    }),
    /rate limit/i,
  );
  assert.equal(requests, 1);
});

test("Jev judges up to 40 candidates in batches and ranks accepted results across both", async () => {
  const many = Array.from({ length: 41 }, (_, i) => ({
    name: `candidate_${i + 1}`,
    aliases: [],
  }));
  const batches: string[][] = [];
  const result = await judgeEmojiRelevance("celebration", many, {
    apiKey: "test-key",
    fetch: async (_url, init) => {
      const { questions } = JSON.parse(String(init?.body)) as {
        questions: Record<string, { instructions: string }>;
      };
      batches.push(
        Object.values(questions).map(({ instructions }) => instructions),
      );
      const scores = batches.length === 1 ? [0.8] : [0.95, 0.69, 0.7];
      return Response.json({
        answers: Object.fromEntries(
          Object.keys(questions).map((id, i) => [
            id,
            { type: "noul", noul: scores[i] ?? 0.1 },
          ]),
        ),
      });
    },
  });
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [20, 20],
  );
  assert.match(batches[1][19], /"candidate 40"/);
  assert.deepEqual(result, ["candidate_21", "candidate_1", "candidate_23"]);
});
