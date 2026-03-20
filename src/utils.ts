import fs from "fs";
import path from "path";
import { askAI, streamAI } from "./ai";
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

// --- Module-level cache for emoji data and Fuse index ---
let cachedDirectoryPath: string | null = null;
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

/**
 * Loads emoji data from disk and builds the Fuse index.
 * Results are cached — subsequent calls with the same directory are instant.
 */
async function loadEmojiData(directoryPath: string): Promise<{
  emojisData: Record<string, string>;
  aliasesData: Record<string, string[]>;
  fuse: Fuse<FuseSearchable>;
}> {
  if (cachedDirectoryPath === directoryPath && cachedFuse) {
    return {
      emojisData: cachedEmojisData,
      aliasesData: cachedAliasesData,
      fuse: cachedFuse,
    };
  }

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

  let emojisData: Record<string, string>;
  let aliasesData: Record<string, string[]>;
  try {
    emojisData = JSON.parse(emojisRaw);
    aliasesData = JSON.parse(aliasesRaw);
  } catch (error) {
    throw new Error(
      "Emoji JSON files are corrupted or invalid. Try re-downloading your emoji collection.",
    );
  }

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

  const fuse = new Fuse(fuseSearchList, {
    keys: ["searchTerm"],
    threshold: 0.3,
  });

  cachedDirectoryPath = directoryPath;
  cachedEmojisData = emojisData;
  cachedAliasesData = aliasesData;
  cachedFuse = fuse;

  return { emojisData, aliasesData, fuse };
}

/** Clears the module-level emoji data cache, forcing a reload on the next search. */
export function clearEmojiCache(): void {
  cachedDirectoryPath = null;
  cachedEmojisData = {};
  cachedAliasesData = {};
  cachedFuse = null;
}

const EXTRACTION_SYSTEM_PROMPT = `Find emojis in a Slack custom emoji collection. Given a phrase, output 6-10 plausible emoji name fragments as a JSON array.

Think about: reactions (facepalm, slow-clap, this-is-fine), emotions (love, mind-blown), objects (taco, rocket), memes/characters (picard, doge, elmo), compound names (mic-drop, chef-kiss), and slang equivalents ("throw out"→yeet, "agree"→this, "drunk"→wasted).

Rules: prefer reaction concepts over person names; translate idioms to their cultural emoji equivalent; think about what someone would name the emoji, not just the literal words.

Examples:
"are you kidding me?" → ["facepalm", "really", "bruh", "eye-roll", "picard", "seriously", "disbelief"]
"ship it" → ["ship", "rocket", "deploy", "shipit", "lgtm", "launch"]

Return ONLY a valid JSON array, no other text.`;

/**
 * Extracts a JSON array from a raw LLM response, tolerating common local model quirks:
 * - Qwen3 <think>...</think> reasoning blocks
 * - Markdown code fences (```json ... ```)
 * - Extra prose before or after the array
 */
function extractJsonArray(raw: string): unknown[] {
  // Strip <think>...</think> blocks (Qwen3 thinking mode)
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // Strip markdown code fences
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to regex extraction
  }

  // Extract the first [...] block and try parsing that
  const match = cleaned.match(/\[[\s\S]*?\]/);
  if (match) {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed)) return parsed;
  }

  throw new Error("No JSON array found in LLM response");
}

/**
 * Uses AI to generate plausible emoji name candidates for a user query.
 */
async function extractSearchTerms(query: string): Promise<string[]> {
  const fallback = query.split(/\s+/).filter((w) => w.length > 2);

  try {
    const aiResponse = await askAI(query, EXTRACTION_SYSTEM_PROMPT);
    console.log("[search] AI raw response:", aiResponse.trim());

    const candidates = extractJsonArray(aiResponse);
    console.log("[search] AI candidates:", candidates);
    return candidates as string[];
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
 * Searches the emoji directory using an AI pipeline:
 * 1. AI generates plausible emoji name candidates for the query
 * 2. Each term produces substring and fuzzy candidates
 * 3. Candidates are ranked globally across all terms
 */
export const readEmojiDirectory = async (
  directoryPath: string,
  aiSearchTerm: string,
  ignoreList: string[] = [],
): Promise<emojiItem[]> => {
  if (aiSearchTerm.trim() === "") return [];

  const { emojisData, aliasesData, fuse } = await loadEmojiData(directoryPath);
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

  return finalNames.map((name) => ({
    emojiPath: path.join(directoryPath, "emojis", emojisData[name]),
    keywords: [name, ...(aliasesData[name] ?? [])],
  }));
};

/**
 * Streaming variant of the emoji search pipeline.
 * Calls `onUpdate` progressively as each AI-generated term is received and searched,
 * so results appear in the UI before the AI finishes generating all candidates.
 * Falls back to the non-streaming pipeline on error.
 */
export async function searchEmojisStream(
  directoryPath: string,
  aiSearchTerm: string,
  ignoreList: string[] = [],
  onUpdate: (emojis: emojiItem[]) => void,
): Promise<void> {
  if (aiSearchTerm.trim() === "") return;

  const { emojisData, aliasesData, fuse } = await loadEmojiData(directoryPath);
  const allEmojiNames = Object.keys(emojisData);
  const termMatches: EmojiTermMatches[] = [];

  const processTerm = (term: string) => {
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

    const finalNames = rankEmojiMatches(termMatches, {
      query: aiSearchTerm,
      limit: 20,
      ignoreList,
    }).filter((name) => name in emojisData);

    onUpdate(
      finalNames.map((name) => ({
        emojiPath: path.join(directoryPath, "emojis", emojisData[name]),
        keywords: [name, ...(aliasesData[name] ?? [])],
      })),
    );
  };

  try {
    await streamAI(aiSearchTerm, EXTRACTION_SYSTEM_PROMPT, processTerm);
  } catch (error) {
    console.error(
      "[search] Streaming AI failed, falling back to non-streaming:",
      error,
    );
    const emojis = await readEmojiDirectory(
      directoryPath,
      aiSearchTerm,
      ignoreList,
    );
    onUpdate(emojis);
  }
}
