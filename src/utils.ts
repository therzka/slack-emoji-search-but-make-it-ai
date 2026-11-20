import fs from "fs";
import path from "path";
import Fuse from "fuse.js";
import {
  JEV_CANDIDATE_LIMIT,
  judgeEmojiRelevance,
  streamLocalTerms,
  type LocalModel,
} from "./ai";
import { rankEmojiMatches, type EmojiTermMatches } from "./ranking";

export type emojiItem = {
  emojiPath: string;
  keywords: string[];
};

type EmojiData = {
  emojis: Record<string, string>;
  aliases: Record<string, string[]>;
  names: { name: string; term: string }[];
  fuse: Fuse<{ name: string; term: string }>;
};

let cache: { directory: string; data: EmojiData } | undefined;

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

async function loadEmojiData(directory: string): Promise<EmojiData> {
  if (cache?.directory === directory) return cache.data;

  const [emojisRaw, aliasesRaw] = await Promise.all([
    fs.promises.readFile(path.join(directory, "emojis/emojis.json"), "utf8"),
    fs.promises.readFile(path.join(directory, "emojis/aliases.json"), "utf8"),
  ]).catch((error: unknown) => {
    throw new Error(
      `Could not read emojis/emojis.json and emojis/aliases.json from "${directory}".`,
      { cause: error },
    );
  });

  let emojis: EmojiData["emojis"];
  let aliases: EmojiData["aliases"];
  try {
    emojis = JSON.parse(emojisRaw);
    aliases = JSON.parse(aliasesRaw);
  } catch (error) {
    throw new Error(
      "Emoji JSON files are invalid. Try re-downloading your emoji collection.",
      { cause: error },
    );
  }

  const names = Object.keys(emojis)
    .filter((name) => !/^big_.+_\d{2,}$/.test(name))
    .flatMap((name) =>
      [name, ...(aliases[name] ?? [])].map((label) => ({
        name,
        term: normalize(label),
      })),
    )
    .filter(({ term }) => term);

  const data = {
    emojis,
    aliases,
    names,
    fuse: new Fuse(names, { keys: ["term"], threshold: 0.3 }),
  };
  cache = { directory, data };
  return data;
}

export function clearEmojiCache(): void {
  cache = undefined;
}

const REACTION_TERMS = [
  [/\bship it\b/, ["launch", "deploy", "rocket"]],
  [
    /\b(lgtm|looks good to me|i agree)\b/,
    ["approved", "thumbs up", "check mark"],
  ],
  [
    /\b(are you kidding|pointless meeting|hate meetings)\b/,
    ["facepalm", "eye roll", "bruh"],
  ],
  [/\b(celebrat\w*|congrats|we did it)\b/, ["party", "tada", "confetti"]],
  [/\b(holy moly|wow|mind blown)\b/, ["surprised", "mind blown", "shocked"]],
] as const;
const STOP_WORDS = new Set(
  "a am an and are as at be for from how i in is it me my of on or that the this to was we with you".split(
    " ",
  ),
);
const LOCAL_RESULT_LIMIT = 20;

type SearchOptions = {
  ignoreList?: string[];
  signal?: AbortSignal;
} & (
  | { mode: "jev"; apiKey: string; judge?: typeof judgeEmojiRelevance }
  | { mode: "local"; model?: LocalModel }
);

export async function searchEmojis(
  directory: string,
  query: string,
  options: SearchOptions,
  onUpdate: (emojis: emojiItem[]) => void,
): Promise<void> {
  if (!query.trim()) return;
  const signal = options.signal ?? new AbortController().signal;
  const data = await loadEmojiData(directory);
  signal.throwIfAborted();
  const normalized = normalize(query);
  const termMatches: EmojiTermMatches[] = [];
  const seen = new Set<string>();
  const matchLimit = options.mode === "jev" ? JEV_CANDIDATE_LIMIT : 5;

  const addTerm = (value: string) => {
    const term = normalize(value);
    if (!term || seen.has(term)) return;
    seen.add(term);

    const substringMatches = new Set<string>();
    for (const { name, term: label } of data.names) {
      if (label === term) substringMatches.add(name);
    }
    for (const { name, term: label } of data.names) {
      if (substringMatches.size >= matchLimit) break;
      if (label.includes(term)) substringMatches.add(name);
    }
    const fuseMatches = [
      ...new Set(
        data.fuse
          .search(term, { limit: matchLimit * 2 })
          .map(({ item }) => item.name),
      ),
    ].slice(0, matchLimit);
    termMatches.push({
      term,
      substringMatches: [...substringMatches].slice(0, matchLimit),
      fuseMatches,
    });
  };

  addTerm(normalized);
  for (const word of normalized.split(" ").slice(0, 20)) {
    if (word.length > 1 && !STOP_WORDS.has(word)) addTerm(word);
  }
  for (const [pattern, terms] of REACTION_TERMS) {
    if (pattern.test(normalized)) terms.forEach(addTerm);
  }

  const shortlist = () =>
    rankEmojiMatches(termMatches, {
      query,
      limit: options.mode === "jev" ? JEV_CANDIDATE_LIMIT : LOCAL_RESULT_LIMIT,
      ignoreList: options.ignoreList,
    });
  const publish = (names: string[]) => {
    signal.throwIfAborted();
    onUpdate(
      names.map((name) => ({
        emojiPath: path.join(directory, "emojis", data.emojis[name]),
        keywords: [name, ...(data.aliases[name] ?? [])],
      })),
    );
  };

  if (options.mode === "jev") {
    const candidates = shortlist().map((name) => ({
      name,
      aliases: data.aliases[name] ?? [],
    }));
    publish(
      candidates.length
        ? await (options.judge ?? judgeEmojiRelevance)(query, candidates, {
            apiKey: options.apiKey,
            signal,
          })
        : [],
    );
    return;
  }

  publish(shortlist());
  if (options.model) {
    await streamLocalTerms(
      query,
      options.model,
      (term) => {
        addTerm(term);
        publish(shortlist());
      },
      signal,
    );
  }
}
