import { requestSignal } from "./utils/requestSignal";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const MIN_RELEVANCE = 0.7;
const JEV_BATCH_SIZE = 20;
export const JEV_CANDIDATE_LIMIT = 40;

type Candidate = { name: string; aliases: string[] };
type JudgeOptions = {
  apiKey: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
};
type Decision = { name: string; score: number };

export async function judgeEmojiRelevance(
  query: string,
  candidates: Candidate[],
  options: JudgeOptions,
): Promise<string[]> {
  const shortlist = candidates.slice(0, JEV_CANDIDATE_LIMIT);
  if (!shortlist.length) return [];
  const apiKey = options.apiKey.trim();
  if (!apiKey)
    throw new Error("Set a TypeSafe API key in extension preferences.");

  const decisions: Decision[] = [];
  for (let offset = 0; offset < shortlist.length; offset += JEV_BATCH_SIZE) {
    decisions.push(
      ...(await judgeBatch(
        query,
        shortlist.slice(offset, offset + JEV_BATCH_SIZE),
        {
          ...options,
          apiKey,
        },
      )),
    );
  }
  return decisions
    .filter(({ score }) => score >= MIN_RELEVANCE)
    .sort((a, b) => b.score - a.score)
    .map(({ name }) => name);
}

async function judgeBatch(
  query: string,
  batch: Candidate[],
  options: JudgeOptions,
): Promise<Decision[]> {
  const questions = Object.fromEntries(
    batch.map(({ name, aliases }, index) => {
      const labels = [name, ...aliases.slice(0, 4)].map((label) =>
        label.slice(0, 80).replace(/[_-]+/g, " "),
      );
      return [
        `c${index}`,
        {
          type: "noul",
          instructions: `Would the emoji with these names ${JSON.stringify(labels)} be a fitting Slack emoji for \`query\`?`,
          criteria: {
            true: "The emoji matches the requested concept or expresses the intended reaction.",
            false:
              "The names only share incidental words with the query or suggest a different reaction.",
          },
        },
      ];
    }),
  );
  const { signal, dispose } = requestSignal(10_000, options.signal);
  const request = options.fetch ?? fetch;
  try {
    signal.throwIfAborted();
    const response = await request(JEV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal,
      body: JSON.stringify({
        model: "jev-latest",
        state: { query },
        questions,
      }),
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "TypeSafe rejected the API key. Check your extension preferences.",
      );
    }
    if (response.status === 429)
      throw new Error("TypeSafe rate limit reached. Try again later.");
    if (!response.ok)
      throw new Error(
        `TypeSafe relevance request failed (HTTP ${response.status}).`,
      );

    const data = (await response.json()) as {
      answers?: Record<string, { type?: unknown; noul?: unknown }>;
    } | null;
    return batch.map(({ name }, index) => {
      const answer = data?.answers?.[`c${index}`];
      const score = answer?.noul;
      if (
        answer?.type !== "noul" ||
        typeof score !== "number" ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 1
      ) {
        throw new Error("TypeSafe returned an invalid relevance decision.");
      }
      return { name, score };
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    if (signal.aborted)
      throw new Error("TypeSafe relevance request timed out.");
    throw error;
  } finally {
    dispose();
  }
}
