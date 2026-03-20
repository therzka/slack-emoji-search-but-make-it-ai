import fs from "fs";
import path from "path";
import { askAI } from "./ai";
import Fuse from "fuse.js";
import {
  getRankedEmojiMatches,
  rankEmojiMatches,
  type EmojiTermMatches,
} from "./ranking";

export type emojiItem = {
  emojiPath: string;
  keywords: string[];
};

export type EmojiSource =
  | { type: "local"; directory: string }
  | { type: "github"; owner: string; repo: string; branch: string };

// --- Module-level cache for emoji data and Fuse index ---
let cachedSourceKey: string | null = null;
let cachedEmojisData: Record<string, string> = {};
let cachedAliasesData: Record<string, string[]> = {};
let cachedFuse: Fuse<FuseSearchable> | null = null;

interface FuseSearchable {
  canonicalName: string;
  searchTerm: string;
}

/** Returns true if the emoji name looks like an animation frame (e.g., big_facepalm_01). */
function isAnimationFrame(name: string): boolean {
  return /^big_.+_\d{2,}$/.test(name);
}

/** Returns a stable string key identifying an EmojiSource for caching. */
function getSourceKey(source: EmojiSource): string {
  if (source.type === "local") return source.directory;
  return `github:${source.owner}/${source.repo}@${source.branch}`;
}

/** Validates that a GitHub path segment contains only safe characters. */
function isValidGitHubSegment(segment: string): boolean {
  return /^[a-zA-Z0-9_.\-]+$/.test(segment);
}

/** Validates that an emoji relative path from emojis.json is safe (no traversal). */
function isValidEmojiRelativePath(relPath: string): boolean {
  return (
    typeof relPath === "string" &&
    relPath.length > 0 &&
    !relPath.startsWith("/") &&
    !relPath.includes("..") &&
    !/[\0\r\n]/.test(relPath)
  );
}

/** Builds the Fuse search index from emoji and alias data. */
function buildFuseIndex(
  emojisData: Record<string, string>,
  aliasesData: Record<string, string[]>,
): Fuse<FuseSearchable> {
  const fuseSearchList: FuseSearchable[] = [];
  for (const name of Object.keys(emojisData)) {
    fuseSearchList.push({
      canonicalName: name,
      searchTerm: name.replace(/_/g, " "),
    });
    if (aliasesData[name]) {
      for (const alias of aliasesData[name]) {
        fuseSearchList.push({
          canonicalName: name,
          searchTerm: alias.replace(/_/g, " "),
        });
      }
    }
  }
  return new Fuse(fuseSearchList, { keys: ["searchTerm"], threshold: 0.3 });
}

/**
 * Loads emoji data from the local filesystem and builds the Fuse index.
 */
async function loadEmojiDataFromLocal(directoryPath: string): Promise<{
  emojisData: Record<string, string>;
  aliasesData: Record<string, string[]>;
}> {
  const emojisPath = path.join(directoryPath, "emojis/emojis.json");
  const aliasesPath = path.join(directoryPath, "emojis/aliases.json");

  let emojisRaw: string;
  let aliasesRaw: string;
  try {
    [emojisRaw, aliasesRaw] = await Promise.all([
      fs.promises.readFile(emojisPath, "utf8"),
      fs.promises.readFile(aliasesPath, "utf8"),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `Could not read emoji files from "${directoryPath}". Make sure the directory contains emojis/emojis.json and emojis/aliases.json. (${detail})`,
    );
  }

  return parseEmojiJson(emojisRaw, aliasesRaw);
}

/**
 * Loads emoji data from a public GitHub repository and builds the Fuse index.
 */
async function loadEmojiDataFromGitHub(
  owner: string,
  repo: string,
  branch: string,
): Promise<{
  emojisData: Record<string, string>;
  aliasesData: Record<string, string[]>;
}> {
  if (
    !isValidGitHubSegment(owner) ||
    !isValidGitHubSegment(repo) ||
    !isValidGitHubSegment(branch)
  ) {
    throw new Error(
      `Invalid GitHub repository configuration. Owner, repo, and branch must contain only alphanumeric characters, hyphens, dots, and underscores.`,
    );
  }

  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;

  let emojisRaw: string;
  let aliasesRaw: string;
  try {
    const [emojisRes, aliasesRes] = await Promise.all([
      fetch(`${base}/emojis/emojis.json`),
      fetch(`${base}/emojis/aliases.json`),
    ]);
    if (!emojisRes.ok)
      throw new Error(
        `emojis.json responded with HTTP ${emojisRes.status}`,
      );
    if (!aliasesRes.ok)
      throw new Error(
        `aliases.json responded with HTTP ${aliasesRes.status}`,
      );
    [emojisRaw, aliasesRaw] = await Promise.all([
      emojisRes.text(),
      aliasesRes.text(),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `Could not fetch emoji files from GitHub "${owner}/${repo}" (branch: ${branch}). Make sure the repository is public and contains emojis/emojis.json and emojis/aliases.json. (${detail})`,
    );
  }

  return parseEmojiJson(emojisRaw, aliasesRaw);
}

/** Parses the raw JSON strings from either source. */
function parseEmojiJson(
  emojisRaw: string,
  aliasesRaw: string,
): { emojisData: Record<string, string>; aliasesData: Record<string, string[]> } {
  try {
    return {
      emojisData: JSON.parse(emojisRaw),
      aliasesData: JSON.parse(aliasesRaw),
    };
  } catch {
    throw new Error(
      "Emoji JSON files are corrupted or invalid. Try re-downloading your emoji collection.",
    );
  }
}

/**
 * Loads emoji data from the given source and builds the Fuse index.
 * Results are cached — subsequent calls with the same source are instant.
 */
async function loadEmojiData(source: EmojiSource): Promise<{
  emojisData: Record<string, string>;
  aliasesData: Record<string, string[]>;
  fuse: Fuse<FuseSearchable>;
}> {
  const key = getSourceKey(source);
  if (cachedSourceKey === key && cachedFuse) {
    return {
      emojisData: cachedEmojisData,
      aliasesData: cachedAliasesData,
      fuse: cachedFuse,
    };
  }

  const { emojisData, aliasesData } =
    source.type === "local"
      ? await loadEmojiDataFromLocal(source.directory)
      : await loadEmojiDataFromGitHub(source.owner, source.repo, source.branch);

  const fuse = buildFuseIndex(emojisData, aliasesData);

  cachedSourceKey = key;
  cachedEmojisData = emojisData;
  cachedAliasesData = aliasesData;
  cachedFuse = fuse;

  return { emojisData, aliasesData, fuse };
}

/** Clears the module-level emoji data cache, forcing a reload on the next search. */
export function clearEmojiCache(): void {
  cachedSourceKey = null;
  cachedEmojisData = {};
  cachedAliasesData = {};
  cachedFuse = null;
}

const EXTRACTION_SYSTEM_PROMPT = `You help find emojis in a large Slack custom emoji collection.
Given a user's phrase, generate plausible emoji names that would be relevant.

Think about:
- Reaction emojis (facepalm, thumbsup, fire, this-is-fine, etc.)
- Emotion emojis (happy, sad, love, mind-blown, etc.)
- Object/literal emojis (taco, coffee, rocket, etc.)
- Character/meme emojis (picard, bufo, elmo, doge, etc.)
- Compound names with hyphens (slow-clap, mic-drop, chef-kiss, etc.)
- Internet culture, slang, and meme language — translate colloquial phrases to their cultural equivalents (e.g. "throw out" → yeet, "agree" → this, "do it" → just-do-it, "no problem" → no-sweat, "very fast" → zoom or speedrun, "drunk" → wasted, "chaotic" → shrug or anarchy)

Rules:
- Prefer reusable reaction concepts over person-specific names or usernames
- Avoid likely usernames, employee names, or custom proper nouns unless the user explicitly asked for that person or name
- When the phrase already has a strong reaction idiom (like "holy moly"), prefer that phrase and closely related reactions over generic single words
- Think about what someone would name a relevant emoji, not just the literal words in the query

Return 10-15 emoji name fragments as a JSON array. These will be fuzzy-matched, so approximate names are fine.

Examples:
"are you kidding me?" → ["facepalm", "really", "bruh", "shocked", "disbelief", "eye-roll", "picard", "seriously", "sarcastic", "what"]
"throw it out" → ["yeet", "trash", "garbage", "toss", "nope", "bye", "delete", "dumpster"]
"I love tacos" → ["taco", "love", "heart", "sparkle", "star"]
"good morning" → ["morning", "sunrise", "sun", "wave", "coffee"]
"holy moly" → ["holy-moly", "whoa", "wow", "omg", "gasp", "mind-blown", "shocked", "astonished", "hallelujah"]
"ship it" → ["ship", "rocket", "deploy", "shipit", "lgtm", "launch"]

Return ONLY a valid JSON array, no other text.`;

/**
 * Uses AI to generate plausible emoji name candidates for a user query.
 */
async function extractSearchTerms(query: string): Promise<string[]> {
  const fallback = query.split(/\s+/).filter((w) => w.length > 2);

  try {
    const aiResponse = await askAI(query, EXTRACTION_SYSTEM_PROMPT);
    console.log("[search] AI raw response:", aiResponse.trim());

    const parsed = JSON.parse(aiResponse.trim());
    const candidates = Array.isArray(parsed) ? parsed : fallback;
    console.log("[search] AI candidates:", candidates);
    return candidates;
  } catch (error) {
    console.error("[search] AI extraction failed, using fallback:", error);
    console.log("[search] Fallback terms:", fallback);
    return fallback;
  }
}

/**
 * Finds emoji names that contain the given term as a substring.
 */
function substringMatchEmojis(
  term: string,
  emojiNames: string[],
  limit: number,
): string[] {
  const lower = term.toLowerCase();
  const matches: string[] = [];
  for (const name of emojiNames) {
    if (name.toLowerCase().includes(lower)) {
      matches.push(name);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}
/**
 * Searches the emoji source using an AI pipeline:
 * 1. AI generates plausible emoji name candidates for the query
 * 2. Each term produces substring and fuzzy candidates
 * 3. Candidates are ranked globally across all terms
 *
 * Supports both local directories and public GitHub repositories.
 */
export const readEmojiDirectory = async (
  source: EmojiSource,
  aiSearchTerm: string,
  ignoreList: string[] = [],
): Promise<emojiItem[]> => {
  if (aiSearchTerm.trim() === "") return [];

  const { emojisData, aliasesData, fuse } = await loadEmojiData(source);
  const allEmojiNames = Object.keys(emojisData);

  // AI-generated emoji name candidates
  const candidates = await extractSearchTerms(aiSearchTerm);

  console.log("[search] Query:", JSON.stringify(aiSearchTerm));
  console.log("[search] Search terms:", candidates);

  const termMatches: EmojiTermMatches[] = [];

  // Search all AI candidates with substring + Fuse
  for (const term of candidates) {
    const substrMatches = substringMatchEmojis(term, allEmojiNames, 5);
    const fuseResults = fuse.search(term, { limit: 5 });
    const fuseNames = fuseResults.map((r) => r.item.canonicalName);

    termMatches.push({
      term,
      substringMatches: substrMatches.filter((name) => !isAnimationFrame(name)),
      fuseMatches: fuseNames.filter((name) => !isAnimationFrame(name)),
    });

    console.log(
      `[search] Term "${term}": ${substrMatches.length} substring, ${fuseNames.length} fuse`,
    );
    if (substrMatches.length > 0)
      console.log(
        `[search]   substring: ${substrMatches.slice(0, 10).join(", ")}${substrMatches.length > 10 ? "..." : ""}`,
      );
    if (fuseNames.length > 0)
      console.log(
        `[search]   fuse: ${fuseNames.slice(0, 10).join(", ")}${fuseNames.length > 10 ? "..." : ""}`,
      );
  }

  const rankedMatches = getRankedEmojiMatches(termMatches, aiSearchTerm);
  console.log("[search] Top ranked matches:");
  for (const match of rankedMatches.slice(0, 10)) {
    console.log(
      `[search]   ${match.name} score=${match.score.toFixed(1)} context=${match.queryContextHits} terms=${match.matchedTermsCount} substring=${match.substringHits} fuse=${match.fuseHits}`,
    );
  }

  const finalNames = rankEmojiMatches(termMatches, {
    query: aiSearchTerm,
    limit: 20,
    ignoreList,
  }).filter((name) => name in emojisData);

  console.log(`[search] Final: ${finalNames.length} emojis returned`);
  console.log(
    `[search]   ${finalNames.slice(0, 15).join(", ")}${finalNames.length > 15 ? "..." : ""}`,
  );

  return finalNames.map((name) => {
    const relativePath = emojisData[name];
    let emojiPath: string;
    if (source.type === "local") {
      emojiPath = path.join(source.directory, "emojis", relativePath);
    } else if (isValidEmojiRelativePath(relativePath)) {
      emojiPath = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/emojis/${relativePath}`;
    } else {
      return null;
    }
    return {
      emojiPath,
      keywords: [name, ...(aliasesData[name] ?? [])],
    };
  }).filter((item): item is emojiItem => item !== null);
};
