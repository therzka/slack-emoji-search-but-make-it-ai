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

/**
 * Sends a prompt to the configured AI provider and returns the assistant's response text.
 * Supports GitHub Models (cloud) and local OpenAI-compatible LLM servers (e.g. Ollama, LM Studio).
 */
export async function askAI(prompt: string, system?: string): Promise<string> {
  const { aiProvider, githubToken, aiModel, localEndpoint, localModel } =
    getPreferenceValues<AIPreferences>();

  const messages: ChatMessage[] = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: prompt });

  if (aiProvider === "local") {
    return callLocalLLM(localEndpoint, localModel, messages);
  }

  return callGitHubModels(githubToken, aiModel, messages);
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
    body: JSON.stringify({ model, messages }),
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
