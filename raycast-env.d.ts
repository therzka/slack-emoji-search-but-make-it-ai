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
  /** AI Provider - Search locally or opt in to TypeSafe Jev cloud relevance checks */
  "aiProvider": "local" | "jev",
  /** TypeSafe API Key - Required only for TypeSafe Jev. Jev receives your query and shortlisted emoji names and aliases. */
  "typesafeApiKey"?: string,
  /** Ignore List - Comma-separated list of emoji name prefixes to exclude from results (e.g. ofub, someprefix) */
  "ignoreList": string,
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

