# Slack Emoji AI Search

A [Raycast](https://raycast.com) extension that semantically searches a local Slack emoji collection using AI. Describe a feeling, phrase, or concept, and let AI find the most relevant emojis for you.

<details><summary>Screenshots</summary>

<img width="500" alt="image" src="https://github.com/user-attachments/assets/0c1bc319-743a-43ee-b689-dcee4aa6fd24" /> 
<img width="500" alt="image" src="https://github.com/user-attachments/assets/bb3f9b90-e467-47a9-8857-787c37ea41dc" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/ff481ff3-434e-44ab-8de7-726e409ac057" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/677d1be1-18f3-4036-8997-3e68f350b4eb" />

</details>

## Prerequisites

- [Raycast](https://raycast.com) installed
- A local directory of Slack emojis with the expected structure (see below)
- **One of:**
  - A GitHub Personal Access Token (PAT) with the `models:read` scope — [create one here](https://github.com/settings/tokens)
  - A local LLM server (e.g. [Ollama](https://ollama.com)) with a small model installed (see [Recommended Local Models](#recommended-local-models))

### Expected Emoji Directory Structure

Your emoji directory must contain an `emojis/` subfolder with two JSON files:

```
your-emoji-directory/
└── emojis/
    ├── emojis.json     # { "emoji_name": "relative/path/to/image.png", ... }
    ├── aliases.json    # { "emoji_name": ["alias1", "alias2"], ... }
    └── ...             # image files referenced by emojis.json
```

- **`emojis.json`** — maps emoji names to relative image file paths
- **`aliases.json`** — maps emoji names to lists of alias names

## Setup

1. Prepare your emoji directory in the structure above
2. Install and open this extension in Raycast
3. In extension preferences, set:
   - **Emoji Directory** — path to your emoji directory
   - **AI Provider** — GitHub Models (cloud) or Local LLM
   - For **GitHub Models**: set your GitHub PAT and optionally choose a model (defaults to GPT-5 mini)
   - For **Local LLM**: set the endpoint URL and model name (see [Recommended Local Models](#recommended-local-models))
   - **Ignore List** *(optional)* — comma-separated terms to filter out of results (any emoji whose name contains a matching segment is excluded)

## Usage

Open the **Search Slack Emojis with AI** command in Raycast. Type a phrase or describe a feeling and press **Enter** to search. Results stream in progressively as the AI generates candidates.

**Example queries:** "celebrating a win", "i hate meetings", "holy moly", "lgtm", "ship it"

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Enter** | Search with AI |
| **⌘ V** | Paste `:emoji_name:` into the active app |
| **⌘ C** | Copy `:emoji_name:` to clipboard |
| **⌘ ⇧ Enter** | Copy emoji image file to clipboard |
| **⌘ L** | Show aliases for the selected emoji |
| **⌘ ⇧ N** | Clear results and start a new search |
| **⌘ U** | Pull latest changes from the emoji git repo |

## How It Works

The extension uses a two-stage AI search pipeline:

1. **Literal + AI candidate generation** — Your query words are searched directly (important for acronyms like "lgtm"), then AI generates 10–15 additional plausible emoji name fragments (e.g., "i hate meetings" → `["facepalm", "eye-roll", "calendar-fire", "frustrated", ...]`)
2. **Local search** — Each candidate is matched against your emoji collection using both substring matching and fuzzy search ([Fuse.js](https://www.fusejs.io/))
3. **Global ranking** — All matches are scored across candidates, with a boost for emojis that share words with your original query

Results stream in progressively — you'll see matches appear as the AI generates each term, rather than waiting for all candidates.

Supports both [GitHub Models](https://github.com/marketplace/models) (cloud) and local OpenAI-compatible LLM servers (Ollama, LM Studio, etc.).

## Recommended Local Models

The AI task here is simple — generating a short list of emoji name guesses — so **small, fast models (1-4B) work great**. You don't need a large model.

| Model | Ollama command | Size | Notes |
|---|---|---|---|
| **Llama 3.2 3B** ⭐ | `ollama pull llama3.2:3b` | ~2 GB | Best speed/quality balance. Recommended starting point. |
| **Phi-4 Mini** | `ollama pull phi4-mini` | ~2.5 GB | Fastest option with great JSON reliability. |
| **Qwen 3 4B** | `ollama pull qwen3:4b` | ~2.5 GB | Strong at structured output. May include `<think>` blocks (handled automatically). |
| **Llama 3.2 1B** | `ollama pull llama3.2:1b` | ~1.3 GB | Ultra-fast but may miss cultural/slang emoji mappings. |

### Local LLM Setup (Ollama)

```sh
# Install Ollama: https://ollama.com
ollama pull llama3.2:3b    # download the recommended model
ollama serve               # start the server (if not already running)
```

Then in extension preferences:
- **AI Provider** → Local LLM
- **Local LLM Endpoint** → `http://localhost:11434/v1/chat/completions`
- **Local LLM Model** → `llama3.2:3b`

> **Performance note:** The first search after opening the extension triggers model loading (~10-30s depending on model size and hardware). Subsequent searches are fast (~1s) since the model stays in memory for 30 minutes. Use `llama3.2:1b` for the fastest loading times.

## License

MIT
