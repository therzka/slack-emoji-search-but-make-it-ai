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
- For cloud relevance decisions: a [TypeSafe API key](https://docs.typesafe.ai/introduction/quickstart)
- Optional for offline query expansion: a local LLM server such as [Ollama](https://ollama.com) (see [Recommended Local Models](#recommended-local-models))

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
   - **AI Provider** — choose **TypeSafe Jev (Cloud)** to enable model-based relevance checks, or leave **Local Search** selected to search without a cloud API
   - For **TypeSafe Jev**: set your TypeSafe API key. GitHub Models has been retired; your old GitHub PAT is not needed.
   - For **Local Search**: optionally set the local LLM endpoint and model for query expansion (see [Recommended Local Models](#recommended-local-models))
   - **Ignore List** *(optional)* — comma-separated terms to filter out of results (any emoji whose name contains a matching segment is excluded)

## Usage

Open the **Search Slack Emojis with AI** command in Raycast. Type a phrase or describe a feeling and press **Enter** to search. Jev results appear after the relevance check; local results appear immediately and update progressively if a local model is configured.

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

1. **Find candidates locally.** Search emoji names and aliases using exact, substring, and fuzzy matches ([Fuse.js](https://www.fusejs.io/)). A small set of common Slack phrases expands locally (e.g., `ship it` → `launch`, `deploy`, `rocket`).
2. **Check relevance in Jev mode.** TypeSafe's Jev answers a separate yes/no relevance question (Noul) for each of up to 40 shortlisted emojis, in batches of no more than 20. Broader searches may take longer or cost more if they need a second request. The app displays only results with a yes probability of at least 0.70, highest first across both batches. If no candidate passes, the app shows no results. A failed request is reported separately.
3. **Stay local if preferred.** Without Jev, results use the local ranking. An optional OpenAI-compatible local model can suggest extra search terms; it does not apply the Jev relevance cutoff.

Jev mode sends the submitted query and shortlisted names and aliases to TypeSafe, not images, file paths, or the full collection. Use local search for private queries or catalogs. An empty shortlist makes no API call. Jev can reject a bad match, but it can't find emojis that weren't shortlisted.

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
- **AI Provider** → Local Search (Optional Local LLM)
- **Local LLM Endpoint** → `http://localhost:11434/v1/chat/completions`
- **Local LLM Model** → `llama3.2:3b`

> **Performance note:** The first search after opening the extension triggers model loading (~10-30s depending on model size and hardware). Subsequent searches are fast (~1s) since the model stays in memory for 30 minutes. Use `llama3.2:1b` for the fastest loading times.

## License

MIT
