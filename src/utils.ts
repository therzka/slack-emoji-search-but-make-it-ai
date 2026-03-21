import fs from "fs";
import path from "path";
import { environment } from "@raycast/api";
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
  return /^[a-zA-Z0-9_.-]+$/.test(segment);
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

// --- Emoji image cache for GitHub sources ---

/** Downloads and caches an emoji image from a GitHub repo, returns local path. */
async function ensureCachedEmojiImage(
  source: Extract<EmojiSource, { type: "github" }>,
  relativePath: string,
  token: string,
): Promise<string> {
  const cacheDir = path.join(
    environment.supportPath,
    "emoji-cache",
    source.owner,
    source.repo,
    source.branch,
  );
  const cachedPath = path.join(cacheDir, relativePath);

  try {
    await fs.promises.access(cachedPath);
    return cachedPath;
  } catch {
    // Not cached yet — download below
  }

  await fs.promises.mkdir(path.dirname(cachedPath), { recursive: true });

  const url = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/emojis/${relativePath}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to download emoji image: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(cachedPath, buffer);
  return cachedPath;
}

/** Clears the cached emoji images from disk. */
export async function clearImageCache(): Promise<void> {
  const cacheDir = path.join(environment.supportPath, "emoji-cache");
  try {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
  } catch {
    // Cache dir might not exist
  }
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
 * Loads emoji data from a GitHub repository (public or private) and builds the Fuse index.
 */
async function loadEmojiDataFromGitHub(
  owner: string,
  repo: string,
  branch: string,
  token?: string,
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
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let emojisRaw: string;
  let aliasesRaw: string;
  try {
    const [emojisRes, aliasesRes] = await Promise.all([
      fetch(`${base}/emojis/emojis.json`, { headers }),
      fetch(`${base}/emojis/aliases.json`, { headers }),
    ]);
    if (!emojisRes.ok)
      throw new Error(`emojis.json responded with HTTP ${emojisRes.status}`);
    if (!aliasesRes.ok)
      throw new Error(`aliases.json responded with HTTP ${aliasesRes.status}`);
    [emojisRaw, aliasesRaw] = await Promise.all([
      emojisRes.text(),
      aliasesRes.text(),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    const isAuthError = detail.includes("401") || detail.includes("403");
    const hint = isAuthError
      ? "If this is a private repository, ensure your GitHub token has the 'repo' scope (classic PAT) or 'contents:read' permission (fine-grained PAT)."
      : "Make sure the repository exists and contains emojis/emojis.json and emojis/aliases.json.";
    throw new Error(
      `Could not fetch emoji files from GitHub "${owner}/${repo}" (branch: ${branch}). ${hint} (${detail})`,
    );
  }

  return parseEmojiJson(emojisRaw, aliasesRaw);
}

/** Parses the raw JSON strings from either source. */
function parseEmojiJson(
  emojisRaw: string,
  aliasesRaw: string,
): {
  emojisData: Record<string, string>;
  aliasesData: Record<string, string[]>;
} {
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
async function loadEmojiData(
  source: EmojiSource,
  token?: string,
): Promise<{
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
      : await loadEmojiDataFromGitHub(
          source.owner,
          source.repo,
          source.branch,
          token,
        );

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

const EXTRACTION_SYSTEM_PROMPT = `Find emojis in a Slack custom emoji collection. Given a phrase, output 10-15 plausible emoji name fragments as a JSON array.

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
 * Searches the emoji source using an AI pipeline:
 * 1. AI generates plausible emoji name candidates for the query
 * 2. Each term produces substring and fuzzy candidates
 * 3. Candidates are ranked globally across all terms
 *
 * Supports both local directories and public/private GitHub repositories.
 */
export const readEmojiDirectory = async (
  source: EmojiSource,
  aiSearchTerm: string,
  ignoreList: string[] = [],
  token?: string,
): Promise<emojiItem[]> => {
  if (aiSearchTerm.trim() === "") return [];

  const { emojisData, aliasesData, fuse } = await loadEmojiData(source, token);
  const allEmojiNames = Object.keys(emojisData);

  // AI-generated emoji name candidates
  const candidates = await extractSearchTerms(aiSearchTerm);

  // Prepend literal query words so exact/acronym matches always appear
  const queryWords = aiSearchTerm
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const allTerms = [
    ...queryWords,
    ...candidates.filter((c) => !queryWords.includes(c.toLowerCase())),
  ];

  console.log("[search] Query:", JSON.stringify(aiSearchTerm));
  console.log("[search] Search terms:", allTerms);

  const termMatches: EmojiTermMatches[] = [];

  // Search all candidates with substring + Fuse
  for (const term of allTerms) {
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

  const items = await Promise.all(
    finalNames
      .filter((name) => name in emojisData)
      .map(async (name) => {
        const relativePath = emojisData[name];
        let emojiPath: string;
        if (source.type === "local") {
          emojiPath = path.join(source.directory, "emojis", relativePath);
        } else if (!isValidEmojiRelativePath(relativePath)) {
          return null;
        } else if (token) {
          try {
            emojiPath = await ensureCachedEmojiImage(
              source,
              relativePath,
              token,
            );
          } catch (err) {
            console.error(`[cache] failed to cache ${name}:`, err);
            emojiPath = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/emojis/${relativePath}`;
          }
        } else {
          emojiPath = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/emojis/${relativePath}`;
        }
        return {
          emojiPath,
          keywords: [name, ...(aliasesData[name] ?? [])],
        };
      }),
  );

  return items.filter((item): item is emojiItem => item !== null);
};

/**
 * Streaming variant of the emoji search pipeline.
 * Calls `onUpdate` progressively as each AI-generated term is received and searched,
 * so results appear in the UI before the AI finishes generating all candidates.
 * Falls back to the non-streaming pipeline on error.
 * Supports both local directories and public/private GitHub repositories.
 */
export async function searchEmojisStream(
  source: EmojiSource,
  aiSearchTerm: string,
  ignoreList: string[] = [],
  onUpdate: (emojis: emojiItem[]) => void,
  token?: string,
): Promise<void> {
  if (aiSearchTerm.trim() === "") return;

  const t0 = Date.now();
  console.log(`[search:stream] START query="${aiSearchTerm}"`);

  const { emojisData, aliasesData, fuse } = await loadEmojiData(source, token);
  const allEmojiNames = Object.keys(emojisData);
  console.log(
    `[search:stream] emoji data loaded (${Date.now() - t0}ms) emojis=${allEmojiNames.length}`,
  );
  const termMatches: EmojiTermMatches[] = [];

  const buildEmojiItem = async (name: string): Promise<emojiItem | null> => {
    const relativePath = emojisData[name];
    if (source.type === "local") {
      return {
        emojiPath: path.join(source.directory, "emojis", relativePath),
        keywords: [name, ...(aliasesData[name] ?? [])],
      };
    }
    if (!isValidEmojiRelativePath(relativePath)) return null;
    let emojiPath: string;
    if (token) {
      try {
        emojiPath = await ensureCachedEmojiImage(source, relativePath, token);
      } catch (err) {
        console.error(`[cache] failed to cache ${name}:`, err);
        emojiPath = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/emojis/${relativePath}`;
      }
    } else {
      emojiPath = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/emojis/${relativePath}`;
    }
    return { emojiPath, keywords: [name, ...(aliasesData[name] ?? [])] };
  };

  const processTerm = async (term: string) => {
    const substrMatches = substringMatchEmojis(term, allEmojiNames, 5);
    const fuseResults = fuse.search(term, { limit: 5 });
    const fuseNames = fuseResults.map((r) => r.item.canonicalName);

    termMatches.push({
      term,
      substringMatches: substrMatches.filter((name) => !isAnimationFrame(name)),
      fuseMatches: fuseNames.filter((name) => !isAnimationFrame(name)),
    });

    console.log(
      `[search:stream] term "${term}": ${substrMatches.length} substring, ${fuseNames.length} fuse (${Date.now() - t0}ms)`,
    );

    const finalNames = rankEmojiMatches(termMatches, {
      query: aiSearchTerm,
      limit: 20,
      ignoreList,
    }).filter((name) => name in emojisData);

    console.log(
      `[search:stream] ranked ${finalNames.length} results after ${termMatches.length} terms`,
    );

    const items = await Promise.all(finalNames.map(buildEmojiItem));
    onUpdate(items.filter((item): item is emojiItem => item !== null));
  };

  try {
    // Always search the literal query first — essential for acronyms and exact names
    const queryWords = aiSearchTerm
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);
    for (const word of queryWords) {
      await processTerm(word);
    }

    console.log(`[search:stream] starting AI stream... (${Date.now() - t0}ms)`);
    let processChain = Promise.resolve();
    await streamAI(aiSearchTerm, EXTRACTION_SYSTEM_PROMPT, (term) => {
      // Skip AI terms we already searched as literal words
      if (!queryWords.includes(term)) {
        processChain = processChain.then(() => processTerm(term));
      }
    });
    await processChain;
    console.log(
      `[search:stream] DONE total=${Date.now() - t0}ms terms=${termMatches.length}`,
    );
  } catch (error) {
    console.error(
      `[search:stream] streaming failed (${Date.now() - t0}ms), falling back:`,
      error,
    );
    const emojis = await readEmojiDirectory(
      source,
      aiSearchTerm,
      ignoreList,
      token,
    );
    console.log(
      `[search:stream] fallback returned ${emojis.length} results (${Date.now() - t0}ms)`,
    );
    onUpdate(emojis);
  }
}
