import { getPreferenceValues } from "@raycast/api";

const GITHUB_MODELS_URL = "https://models.github.ai/inference/chat/completions";
const STREAM_TIMEOUT_MS = 30_000;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

interface AIPreferences {
  aiProvider: string;
  githubToken: string;
  aiModel: string;
  localEndpoint: string;
  localModel: string;
}

// Module-level warmup abort controller so real searches can cancel it
let warmupAbort: AbortController | null = null;

function resolveProvider(prefs: AIPreferences): {
  provider: "github" | "local";
  model: string;
  url: string;
  token?: string;
} {
  const provider =
    (prefs.aiProvider || "github") === "local" ? "local" : "github";
  const model =
    provider === "local"
      ? prefs.localModel || "(unset)"
      : prefs.aiModel || "openai/gpt-5-mini";
  const url = provider === "local" ? prefs.localEndpoint : GITHUB_MODELS_URL;
  return {
    provider,
    model,
    url,
    token: provider === "github" ? prefs.githubToken : undefined,
  };
}

/** Cancel any in-flight warmup request so it doesn't block real searches. */
export function abortWarmup(): void {
  if (warmupAbort) {
    console.log("[ai] aborting warmup to prioritize real search");
    warmupAbort.abort();
    warmupAbort = null;
  }
}

/**
 * Fires a minimal background request to the local LLM to force it to load into memory.
 * Can be cancelled by abortWarmup() if a real search starts before warmup finishes.
 */
export async function warmUpLocalLLM(): Promise<void> {
  const prefs = getPreferenceValues<AIPreferences>();
  const { provider, url, model } = resolveProvider(prefs);
  if (provider !== "local" || !url || !model || model === "(unset)") return;

  warmupAbort = new AbortController();

  try {
    console.log("[ai] warming up local LLM...");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: warmupAbort.signal,
    });
    console.log(`[ai] warmup complete (status ${response.status})`);
  } catch {
    // Ignore warmup failures (including abort) — the real search will surface any real errors
  } finally {
    warmupAbort = null;
  }
}

/**
 * Sends a prompt to the configured AI provider and returns the assistant's response text.
 * Supports GitHub Models (cloud) and local OpenAI-compatible LLM servers (e.g. Ollama, LM Studio).
 */
export async function askAI(prompt: string, system?: string): Promise<string> {
  const prefs = getPreferenceValues<AIPreferences>();
  const { provider, model, url, token } = resolveProvider(prefs);
  console.log(`[ai] provider=${provider} model=${model}`);

  const messages: ChatMessage[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  if (provider === "local") {
    return callLocalLLM(url, model, messages);
  }
  return callGitHubModels(token ?? "", model, messages);
}

/**
 * Streams a prompt to the configured AI provider, calling `onTerm` for each string item
 * extracted from the JSON array as it streams in.
 * Includes a 30-second timeout and detailed diagnostic logging.
 */
export async function streamAI(
  prompt: string,
  system: string | undefined,
  onTerm: (term: string) => void,
): Promise<void> {
  // Cancel any in-flight warmup so it doesn't block this request (Ollama serializes)
  abortWarmup();

  const prefs = getPreferenceValues<AIPreferences>();
  const { provider, model, url, token } = resolveProvider(prefs);
  const t0 = Date.now();

  console.log(
    `[ai:stream] START provider=${provider} model=${model} url=${url}`,
  );

  if (!url) throw new Error("AI endpoint is not configured.");

  const messages: ChatMessage[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider === "github") {
    if (!token) throw new Error("GitHub token is not configured.");
    headers["Authorization"] = `Bearer ${token}`;
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => {
    console.log(`[ai:stream] TIMEOUT after ${STREAM_TIMEOUT_MS}ms — aborting`);
    abort.abort();
  }, STREAM_TIMEOUT_MS);

  let response: Response;
  try {
    console.log(`[ai:stream] fetching... (${Date.now() - t0}ms)`);
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, stream: true }),
      signal: abort.signal,
    });
    console.log(
      `[ai:stream] response headers arrived (${Date.now() - t0}ms) status=${response.status} content-type=${response.headers.get("content-type")}`,
    );
  } catch (error) {
    clearTimeout(timeout);
    const elapsed = Date.now() - t0;
    if (abort.signal.aborted) {
      throw new Error(
        `AI request timed out after ${elapsed}ms. Is your local LLM server running?`,
      );
    }
    throw new Error(
      `AI fetch failed after ${elapsed}ms: ${error instanceof Error ? error.message : error}`,
    );
  }

  if (!response.ok) {
    clearTimeout(timeout);
    const body = await response.text().catch(() => "");
    if (response.status === 401)
      throw new Error(
        "GitHub token is invalid or missing the models:read scope.",
      );
    if (response.status === 429)
      throw new Error(
        "GitHub Models rate limit exceeded. Please try again in a moment.",
      );
    throw new Error(`AI API error (${response.status}): ${body}`);
  }

  if (!response.body) {
    clearTimeout(timeout);
    throw new Error("Streaming response body is null.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let contentBuffer = "";
  let termsFound = 0;
  let chunksReceived = 0;
  let dataLinesLogged = 0;

  try {
    let streaming = true;
    while (streaming) {
      const { done, value } = await reader.read();
      if (done) {
        console.log(
          `[ai:stream] stream ended (done=true) (${Date.now() - t0}ms) chunks=${chunksReceived} terms=${termsFound}`,
        );
        break;
      }

      chunksReceived++;
      const chunk = decoder.decode(value, { stream: true });

      if (chunksReceived === 1) {
        console.log(
          `[ai:stream] first chunk arrived (${Date.now() - t0}ms) length=${chunk.length}`,
        );
        console.log(
          `[ai:stream] first chunk preview: ${JSON.stringify(chunk.slice(0, 200))}`,
        );
      }

      sseBuffer += chunk;
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ") && !line.startsWith("data:")) continue;
        const data = line.replace(/^data:\s*/, "").trim();
        if (data === "[DONE]") {
          console.log(
            `[ai:stream] [DONE] received (${Date.now() - t0}ms) terms=${termsFound}`,
          );
          streaming = false;
          break;
        }

        // Log first few raw SSE data lines for format debugging
        if (dataLinesLogged < 3) {
          console.log(
            `[ai:stream] raw data line #${dataLinesLogged}: ${JSON.stringify(data.slice(0, 200))}`,
          );
          dataLinesLogged++;
        }

        let parsed: { choices?: { delta?: { content?: string } }[] };
        try {
          parsed = JSON.parse(data);
        } catch {
          if (dataLinesLogged <= 3) {
            console.log(
              `[ai:stream] failed to parse SSE data: ${JSON.stringify(data.slice(0, 100))}`,
            );
          }
          continue;
        }

        const delta = parsed.choices?.[0]?.delta?.content ?? "";
        if (!delta) continue;
        contentBuffer += delta;

        // Only look for terms after the JSON array's opening '[' to skip <think> blocks etc.
        const arrayStart = contentBuffer.indexOf("[");
        if (arrayStart === -1) continue;
        const arrayContent = contentBuffer.slice(arrayStart + 1);

        const matches = [...arrayContent.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
        while (termsFound < matches.length) {
          const term = matches[termsFound][1].trim().toLowerCase();
          if (term) {
            console.log(
              `[ai:stream] term #${termsFound}: "${term}" (${Date.now() - t0}ms)`,
            );
            onTerm(term);
          }
          termsFound++;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
    console.log(
      `[ai:stream] DONE total=${Date.now() - t0}ms chunks=${chunksReceived} terms=${termsFound} contentLength=${contentBuffer.length}`,
    );
    if (termsFound === 0 && contentBuffer.length > 0) {
      console.log(
        `[ai:stream] WARNING: received content but extracted 0 terms. Full content: ${JSON.stringify(contentBuffer.slice(0, 500))}`,
      );
    }
  }
}

async function callGitHubModels(
  token: string,
  aiModel: string,
  messages: ChatMessage[],
): Promise<string> {
  const model = aiModel || "openai/gpt-5-mini";

  const response = await fetch(GITHUB_MODELS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401) {
      throw new Error(
        "GitHub token is invalid or missing the models:read scope.",
      );
    }
    if (response.status === 429) {
      throw new Error(
        "GitHub Models rate limit exceeded. Please try again in a moment.",
      );
    }
    throw new Error(`GitHub Models API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("GitHub Models API returned an empty response.");
  }

  return content;
}

async function callLocalLLM(
  endpoint: string,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  if (!endpoint) {
    throw new Error(
      "Local LLM endpoint is not configured. Set it in extension preferences.",
    );
  }
  if (!model) {
    throw new Error(
      "Local LLM model name is not configured. Set it in extension preferences.",
    );
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Local LLM error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Local LLM returned an empty response.");
  }

  return content;
}
