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
  /** GitHub Personal Access Token - PAT with models:read scope for AI-powered search via GitHub Models */
  "githubToken": string
}
}

declare namespace Arguments {
  /** Arguments passed to the `index` command */
  export type Index = {}
}

