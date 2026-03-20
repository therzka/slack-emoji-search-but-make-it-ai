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
  /** Emoji Directory - Path to local emoji directory containing emojis/emojis.json and emojis/aliases.json */
  "emojiDirectory": string,
  /** AI Provider - Choose between GitHub Models (cloud) or a local LLM server (e.g. Ollama, LM Studio) */
  "aiProvider": "github" | "local",
  /** GitHub Personal Access Token - PAT with models:read scope for AI-powered search via GitHub Models (not needed for Local LLM) */
  "githubToken"?: string,
  /** Ignore List - Comma-separated list of emoji name prefixes to exclude from results (e.g. ofub, someprefix) */
  "ignoreList": string,
  /** AI Model (GitHub Models) - GitHub Models model to use for emoji candidate generation */
  "aiModel": "openai/gpt-5-mini" | "openai/gpt-4.1" | "openai/gpt-4.1-mini" | "openai/gpt-4o" | "openai/gpt-4o-mini",
  /** Local LLM Endpoint - OpenAI-compatible chat completions URL for your local LLM (e.g. http://localhost:11434/v1/chat/completions) */
  "localEndpoint": string,
  /** Local LLM Model - Model name to use with your local LLM server (e.g. llama3.2, mistral, gemma2) */
  "localModel": string
}
}

declare namespace Arguments {
  /** Arguments passed to the `index` command */
  export type Index = {}
}

