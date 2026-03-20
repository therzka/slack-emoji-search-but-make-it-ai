import { getPreferenceValues } from "@raycast/api";

const GITHUB_MODELS_URL = "https://models.github.ai/inference/chat/completions";

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
 * extracted from the JSON array as it streams in. Useful for progressive UI updates.
 */
export async function streamAI(
  prompt: string,
  system: string | undefined,
  onTerm: (term: string) => void,
): Promise<void> {
  const prefs = getPreferenceValues<AIPreferences>();
  const { provider, model, url, token } = resolveProvider(prefs);
  console.log(`[ai] streaming provider=${provider} model=${model}`);

  if (!url) throw new Error("Local LLM endpoint is not configured.");

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

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!response.ok) {
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

  if (!response.body) throw new Error("Streaming response body is null.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let contentBuffer = "";
  let termsFound = 0;

  try {
    let streaming = true;
    while (streaming) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") {
          streaming = false;
          break;
        }

        let parsed: { choices?: { delta?: { content?: string } }[] };
        try {
          parsed = JSON.parse(data);
        } catch {
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
          if (term) onTerm(term);
          termsFound++;
        }
      }
    }
  } finally {
    reader.releaseLock();
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
