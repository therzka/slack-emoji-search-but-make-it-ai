# Slack Emoji AI Search

A Raycast extension that semantically searches a local Slack emoji collection using AI. Describe a feeling, phrase, or concept, and let AI find the most relevant emojis for you!


<details><summary>Screenshots</summary>

<img width="500" alt="image" src="https://github.com/user-attachments/assets/0c1bc319-743a-43ee-b689-dcee4aa6fd24" /> 
<img width="500" alt="image" src="https://github.com/user-attachments/assets/bb3f9b90-e467-47a9-8857-787c37ea41dc" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/ff481ff3-434e-44ab-8de7-726e409ac057" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/677d1be1-18f3-4036-8997-3e68f350b4eb" />


</details>




## Prerequisites

- A local directory of Slack emojis with the expected structure (see below)
- A GitHub Personal Access Token (PAT) with the `models:read` scope — [create one here](https://github.com/settings/tokens)

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
   - **GitHub Personal Access Token** — your PAT with `models:read` scope
   - **AI Model** *(optional)* — which GitHub Models model to use. Defaults to GPT-5 mini; switch to GPT-4.1 for more accurate results
   - **Ignore List** *(optional)* — comma-separated terms to exclude from results. Any emoji whose name contains a matching word segment is filtered out.

## Usage

Invoke the **Search Slack Emojis with AI** command in Raycast. Type a phrase or describe a feeling (e.g., "celebrating a win", "i hate meetings", "holy moly") and press **Enter** to search.

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

The extension uses an AI search pipeline powered by [GitHub Models](https://github.com/marketplace/models):

1. **AI candidate generation** — AI analyzes your query and generates 10–15 plausible emoji name fragments (e.g., "i hate meetings" → `["no-meetings", "facepalm", "eye-roll", "calendar-fire", "frustrated", ...]`)
2. **Local search** — Each candidate is searched against your emoji collection using both substring matching and fuzzy search (Fuse.js)
3. **Ranked results** — Matches are ranked globally across all candidates, with a boost for emojis that share context words with your original query

## License

MIT
