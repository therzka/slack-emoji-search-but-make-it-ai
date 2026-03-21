/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `index` command */
  export type Index = ExtensionPreferences & {
  /** Emoji Source - Where to load emojis from — a local directory or a GitHub repository */
  "emojiSource": "local" | "github",
  /** Emoji Directory - Path to local emoji directory containing emojis/emojis.json and emojis/aliases.json (required when Emoji Source is "Local directory") */
  "emojiDirectory"?: string,
  /** GitHub Emoji Repository - GitHub repository with your emoji collection in owner/repo format, e.g. myorg/slack-emojis (required when Emoji Source is "GitHub repository"). Works with both public and private repos. */
  "githubEmojiRepo": string,
  /** GitHub Emoji Branch - Branch of the GitHub emoji repository to use (defaults to main) */
  "githubEmojiBranch": string,
  /** AI Provider - Choose between GitHub Models (cloud) or a local LLM server (e.g. Ollama, LM Studio) */
  "aiProvider": "github" | "local",
  /** GitHub Personal Access Token - PAT with models:read scope for AI-powered search via GitHub Models. For private emoji repos, also add the repo scope (classic PAT) or contents:read permission (fine-grained PAT). Not needed for Local LLM with a public repo. */
  "githubToken"?: string,
  /** Ignore List - Comma-separated list of emoji name prefixes to exclude from results (e.g. ofub, someprefix) */
  "ignoreList": string,
  /** AI Model (GitHub Models) - GitHub Models model to use for emoji candidate generation */
  "aiModel": "openai/gpt-5-mini" | "openai/gpt-4.1" | "openai/gpt-4.1-mini" | "openai/gpt-4o" | "openai/gpt-4o-mini",
  /** Local LLM Endpoint - OpenAI-compatible chat completions URL for your local LLM (e.g. http://localhost:11434/v1/chat/completions) */
  "localEndpoint": string,
  /** Local LLM Model - Model name to use with your local LLM server (e.g. llama3.2:3b, phi4-mini, qwen3:4b) */
  "localModel": string
}
}

declare namespace Arguments {
  /** Arguments passed to the `index` command */
  export type Index = {}
}

