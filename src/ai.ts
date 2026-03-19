import { getPreferenceValues } from "@raycast/api";

const GITHUB_MODELS_URL = "https://models.github.ai/inference/chat/completions";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

/**
 * Sends a prompt to the GitHub Models API and returns the assistant's response text.
 */
export async function askAI(prompt: string, system?: string): Promise<string> {
  const { githubToken, aiModel } = getPreferenceValues<{
    githubToken: string;
    aiModel: string;
  }>();
  const model = aiModel || "openai/gpt-5-mini";

  const messages: ChatMessage[] = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: prompt });

  const response = await fetch(GITHUB_MODELS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
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
