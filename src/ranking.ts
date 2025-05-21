export interface EmojiTermMatches {
  term: string;
  substringMatches: string[];
  fuseMatches: string[];
}

export interface RankedEmojiMatch {
  name: string;
  score: number;
  matchedTermsCount: number;
  exactHits: number;
  substringHits: number;
  fuseHits: number;
  queryContextHits: number;
}

interface MutableRankedEmojiMatch {
  name: string;
  score: number;
  matchedTerms: Set<string>;
  exactHits: number;
  substringHits: number;
  fuseHits: number;
  queryContextHits: number;
  firstSeen: number;
}

const QUERY_STOP_WORDS = new Set([
  "aint",
  "am",
  "an",
  "and",
  "are",
  "been",
  "can",
  "cant",
  "could",
  "did",
  "didnt",
  "do",
  "does",
  "dont",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "id",
  "if",
  "im",
  "in",
  "is",
  "it",
  "its",
  "ive",
  "just",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "us",
  "we",
  "what",
  "when",
  "who",
  "why",
  "you",
  "your",
]);

function singularizeToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) {
    return token.slice(0, -1);
  }

  return token;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .split(/[^a-z0-9-]+/)
    .flatMap((part) => part.split("-"))
    .map(singularizeToken)
    .filter(Boolean);
}

function tokenizeQueryContext(query: string): Set<string> {
  return new Set(
    tokenize(query).filter(
      (token) => token.length >= 4 && !QUERY_STOP_WORDS.has(token),
    ),
  );
}

function countTokenOverlap(left: Set<string>, right: Set<string>): number {
  let overlap = 0;

  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }

  return overlap;
}

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/[_\s]+/g, "-");
}

function matchStrength(name: string, term: string): number {
  const normalizedName = normalizeSearchValue(name);
  const normalizedTerm = normalizeSearchValue(term);

  if (normalizedName === normalizedTerm) return 4;
  if (normalizedName.startsWith(`${normalizedTerm}-`)) return 3;
  if (normalizedName.endsWith(`-${normalizedTerm}`)) return 3;
  if (normalizedName.includes(`-${normalizedTerm}-`)) return 2.5;
  if (normalizedName.includes(normalizedTerm)) return 1.5;

  return 0;
}

export function getRankedEmojiMatches(
  termMatches: EmojiTermMatches[],
  query: string,
): RankedEmojiMatch[] {
  const queryContextTokens = tokenizeQueryContext(query);
  const rankedMatches = new Map<string, MutableRankedEmojiMatch>();
  let firstSeen = 0;

  const getRankedMatch = (name: string): MutableRankedEmojiMatch => {
    const existing = rankedMatches.get(name);
    if (existing) return existing;

    const created: MutableRankedEmojiMatch = {
      name,
      score: 0,
      matchedTerms: new Set<string>(),
      exactHits: 0,
      substringHits: 0,
      fuseHits: 0,
      queryContextHits: 0,
      firstSeen: firstSeen++,
    };
    rankedMatches.set(name, created);
    return created;
  };

  for (const { term, substringMatches, fuseMatches } of termMatches) {
    const seenForTerm = new Set<string>();
    const termTokens = new Set(tokenize(term));

    for (const [index, name] of substringMatches.entries()) {
      const match = getRankedMatch(name);
      const strength = matchStrength(name, term);
      const nameTokens = new Set(tokenize(name));
      const termTokenOverlap = countTokenOverlap(nameTokens, termTokens);

      if (!seenForTerm.has(name)) {
        seenForTerm.add(name);
        match.matchedTerms.add(term);
        match.score += 6;
      }

      match.substringHits += 1;
      if (strength === 4) match.exactHits += 1;
      match.score += 8 - index + strength * 4 + termTokenOverlap * 4;
    }

    for (const [index, name] of fuseMatches.entries()) {
      const match = getRankedMatch(name);
      const strength = matchStrength(name, term);
      const nameTokens = new Set(tokenize(name));
      const termTokenOverlap = countTokenOverlap(nameTokens, termTokens);

      if (!seenForTerm.has(name)) {
        seenForTerm.add(name);
        match.matchedTerms.add(term);
        match.score += 6;
      } else {
        match.score += 2;
      }

      match.fuseHits += 1;
      if (strength === 4) match.exactHits += 1;
      match.score += 3 - index * 0.5 + strength * 3 + termTokenOverlap * 3;
    }
  }

  const finalMatches = [...rankedMatches.values()].map((match) => {
    const nameTokens = new Set(tokenize(match.name));
    const queryContextHits = countTokenOverlap(nameTokens, queryContextTokens);

    match.queryContextHits = queryContextHits;
    match.score += queryContextHits * 30;

    return {
      name: match.name,
      score: match.score,
      matchedTermsCount: match.matchedTerms.size,
      exactHits: match.exactHits,
      substringHits: match.substringHits,
      fuseHits: match.fuseHits,
      queryContextHits: match.queryContextHits,
      firstSeen: match.firstSeen,
    };
  });

  return finalMatches
    .sort((a, b) => {
      if (b.queryContextHits !== a.queryContextHits) {
        return b.queryContextHits - a.queryContextHits;
      }
      if (b.score !== a.score) return b.score - a.score;
      if (b.matchedTermsCount !== a.matchedTermsCount) {
        return b.matchedTermsCount - a.matchedTermsCount;
      }
      if (b.exactHits !== a.exactHits) return b.exactHits - a.exactHits;
      if (b.substringHits !== a.substringHits) {
        return b.substringHits - a.substringHits;
      }
      if (a.firstSeen !== b.firstSeen) return a.firstSeen - b.firstSeen;

      return a.name.localeCompare(b.name);
    })
    .map((match) => ({
      name: match.name,
      score: match.score,
      matchedTermsCount: match.matchedTermsCount,
      exactHits: match.exactHits,
      substringHits: match.substringHits,
      fuseHits: match.fuseHits,
      queryContextHits: match.queryContextHits,
    }));
}

export function rankEmojiMatches(
  termMatches: EmojiTermMatches[],
  options: { query: string; limit: number },
): string[] {
  return getRankedEmojiMatches(termMatches, options.query)
    .slice(0, options.limit)
    .map((match) => match.name);
}
