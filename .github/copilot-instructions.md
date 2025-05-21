<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Project overview

This is a **Raycast extension** that semantically searches a local Slack emoji collection using AI. Users type a feeling or phrase, and the extension finds the most relevant emojis through an AI candidate generation + local fuzzy search pipeline.

Requires a local emoji directory containing `emojis/emojis.json` (name → image path) and `emojis/aliases.json` (name → alias list), configured via the extension's `emojiDirectory` preference. AI is powered by GitHub Models API (requires a PAT with `models:read` scope).

## Build and lint commands

```sh
npm run build    # ray build -e dist
npm run dev      # ray develop (live reload in Raycast)
npm run lint     # ray lint
npm run fix-lint # ray lint --fix
```

There are no tests except for inline regression tests in `src/ranking.test.ts` which can be compiled and run with `tsc + node` (no test runner).

## Architecture

The extension has three source files: `src/index.tsx` (UI), `src/utils.ts` (search pipeline), `src/ranking.ts` (ranking logic). AI calls go through `src/ai.ts` which wraps the GitHub Models API.

### Search pipeline (utils.ts)

Search is triggered on Enter (not on every keystroke):

1. **AI candidate generation** (`extractSearchTerms`): A single AI call generates 10–15 plausible emoji name fragments for the query (e.g. "i hate meetings" → `["no-meetings", "facepalm", "eye-roll", "calendar-fire", ...]`).
2. **Local search** (Fuse.js + substring matching): Each candidate is searched against emoji names with substring scan (limit=5) and Fuse fuzzy search (limit=5, threshold=0.3).
3. **Global ranking** (`src/ranking.ts`): All candidate matches are scored together, with a boost for emojis that share context tokens from the original query. Final cap is 20 results.

### UI (index.tsx)

A `Grid` view with 5 columns. Search is **submit-based** (Enter key triggers `handleSubmitSearch`), not live-as-you-type. Primary action is always "search again"; paste/copy use keyboard shortcuts (⌘V / ⌘C).

## Key conventions

- Use `@raycast/api` for all UI components, preferences, clipboard access.
- AI calls go through `src/ai.ts` which calls the GitHub Models API (`models.github.ai`). The model is `openai/gpt-5-mini`.
- The extension manifest is `package.json` (not a separate manifest file). Command definitions, preferences, and metadata all live there. The `raycast-env.d.ts` file is **auto-generated** from `package.json` — never edit it manually.
- Emoji data comes from two JSON files in the user's emoji directory: `emojis/emojis.json` (name → relative image path) and `emojis/aliases.json` (name → alias list).
