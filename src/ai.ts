import { requestSignal } from "./utils/requestSignal";

export { JEV_CANDIDATE_LIMIT, judgeEmojiRelevance } from "./jev";

export type LocalModel = { endpoint: string; model: string };

const EXTRACTION_PROMPT = `Find emojis in a Slack custom emoji collection. Given a phrase,
return only a JSON array of 10–15 plausible emoji name fragments. Think of
reactions, emotions, objects, memes, compound names, and slang. Translate
idioms into reactions, not just literal words. For example, "are you kidding
me?" could match ["facepalm", "bruh", "eye-roll", "disbelief"].`;

export async function warmUpLocalLLM({
  endpoint,
  model,
}: LocalModel): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
      keep_alive: "30m",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`Local LLM warm-up failed (HTTP ${response.status}).`);
  await response.text();
}

export async function streamLocalTerms(
  query: string,
  { endpoint, model }: LocalModel,
  onTerm: (term: string) => void,
  parentSignal: AbortSignal,
): Promise<void> {
  const { signal, dispose } = requestSignal(60_000, parentSignal);
  try {
    await readLocalTerms(query, { endpoint, model }, onTerm, signal);
  } finally {
    dispose();
  }
}

async function readLocalTerms(
  query: string,
  { endpoint, model }: LocalModel,
  onTerm: (term: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: query },
      ],
      stream: true,
      keep_alive: "30m",
    }),
    signal,
  });
  if (!response.ok)
    throw new Error(`Local LLM request failed (HTTP ${response.status}).`);
  if (!response.body) throw new Error("Local LLM returned no response stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let termsRead = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const event = line.slice(5).trim();
        if (event === "[DONE]") {
          if (!termsRead)
            throw new Error("Local LLM returned no search terms.");
          return;
        }
        if (!event) continue;
        const data: { choices?: { delta?: { content?: string } }[] } =
          JSON.parse(event);
        content += data.choices?.[0]?.delta?.content ?? "";
        const text = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
        if (/<think>/i.test(text)) continue;
        const start = text.indexOf("[");
        if (start < 0) continue;
        const entries = text
          .slice(start + 1)
          .matchAll(/"((?:[^"\\]|\\.)*)"|(\])/g);
        let index = 0;
        for (const entry of entries) {
          if (entry[2] || index >= 15) break;
          if (index++ < termsRead) continue;
          const term: string = JSON.parse(entry[0]);
          if (term.trim()) onTerm(term.trim());
          termsRead++;
        }
      }
      if (done) break;
    }
    if (!termsRead) throw new Error("Local LLM returned no search terms.");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
