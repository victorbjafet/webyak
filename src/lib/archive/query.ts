import { tokenize } from './types';

/**
 * A Twitter-style search grammar over the archive.
 *
 * Parsing is kept entirely separate from executing. The parser is a pure
 * function over a string — trivial to reason about and to change — while the
 * executor decides which IndexedDB index can serve the parsed query. Mixing the
 * two is how a search box ends up with query semantics nobody can state.
 *
 * Anything unrecognised is treated as a **search term**, not an error. A person
 * typing `price: 20` means to search for those words, and refusing the query
 * would be worse than searching it.
 */

export interface ArchiveQuery {
  /** Words that must all appear. Matched as prefixes. */
  terms: string[];
  /** Exact substrings that must appear, from `"quoted"` input. */
  phrases: string[];
  /** Words and phrases that must not appear. */
  excludedTerms: string[];
  excludedPhrases: string[];

  author?: string;
  /** Matched against the community name, case-insensitively, as a substring. */
  group?: string;
  /** ISO dates, inclusive. */
  since?: string;
  until?: string;
  minScore?: number;
  maxScore?: number;

  type?: 'post' | 'comment';
  isReply?: boolean;
  /** Deleted posts are excluded unless asked for, or asked for exclusively. */
  deleted?: 'only' | 'include';
  hasMedia?: boolean;
  mediaType?: 'image' | 'video';

  sort: 'new' | 'old' | 'top';
  limit: number;
}

export const DEFAULT_LIMIT = 300;

/** `2026-01-05`, or `2026-1-5`, normalised for lexicographic ISO comparison. */
function parseDate(value: string, endOfDay = false): string | undefined {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return undefined;
  const [, y, m, d] = match;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  // `created_at` is a full ISO timestamp, so a bare date has to be widened to
  // cover the day rather than matching only midnight.
  return endOfDay ? `${iso}T23:59:59.999Z` : `${iso}T00:00:00.000Z`;
}

/** Splits on spaces but keeps `"quoted runs"` together, including `-"negated"`. */
function lex(input: string): { text: string; negated: boolean; quoted: boolean }[] {
  const out: { text: string; negated: boolean; quoted: boolean }[] = [];
  const pattern = /(-?)(?:"([^"]*)"|(\S+))/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input))) {
    const [, minus, quoted, bare] = match;
    const text = quoted ?? bare ?? '';
    if (!text) continue;
    out.push({ text, negated: minus === '-', quoted: quoted !== undefined });
  }
  return out;
}

export function parseQuery(input: string): ArchiveQuery {
  const query: ArchiveQuery = {
    terms: [],
    phrases: [],
    excludedTerms: [],
    excludedPhrases: [],
    sort: 'new',
    limit: DEFAULT_LIMIT,
  };

  for (const token of lex(input)) {
    // A quoted run is always a phrase, never an operator — `"from:me"` searches
    // for that text, which is the only reading that lets quotes mean "literally".
    if (!token.quoted) {
      const operator = /^([a-z_]+):(.*)$/i.exec(token.text);
      if (operator) {
        const key = operator[1].toLowerCase();
        const value = operator[2];
        if (value && applyOperator(query, key, value, token.negated)) continue;
        // Fell through: not an operator we know. Treat the whole thing as text.
      }
    }

    const target = token.quoted
      ? token.negated
        ? query.excludedPhrases
        : query.phrases
      : token.negated
        ? query.excludedTerms
        : query.terms;

    if (token.quoted) target.push(token.text.toLowerCase());
    else target.push(...tokenize(token.text));
  }

  return query;
}

/** Returns false when the key isn't recognised, so the caller can fall back. */
function applyOperator(
  query: ArchiveQuery,
  key: string,
  value: string,
  negated: boolean,
): boolean {
  const lower = value.toLowerCase();

  switch (key) {
    case 'from':
    case 'author':
    case 'by':
      query.author = value.replace(/^@/, '');
      return true;

    case 'in':
    case 'group':
    case 'community':
      query.group = lower;
      return true;

    case 'since':
    case 'after': {
      const date = parseDate(value);
      if (!date) return false;
      query.since = date;
      return true;
    }

    case 'until':
    case 'before': {
      const date = parseDate(value, true);
      if (!date) return false;
      query.until = date;
      return true;
    }

    // `min_faves` is Twitter's spelling; accepted so muscle memory works.
    case 'min_score':
    case 'min_votes':
    case 'min_faves': {
      const n = Number(value);
      if (Number.isNaN(n)) return false;
      query.minScore = n;
      return true;
    }

    case 'max_score':
    case 'max_votes': {
      const n = Number(value);
      if (Number.isNaN(n)) return false;
      query.maxScore = n;
      return true;
    }

    case 'is':
      switch (lower) {
        case 'post':
          query.type = 'post';
          return true;
        case 'comment':
          query.type = 'comment';
          return true;
        case 'reply':
          query.isReply = !negated;
          return true;
        case 'deleted':
          query.deleted = negated ? undefined : 'only';
          return true;
        default:
          return false;
      }

    case 'has':
      switch (lower) {
        case 'media':
          query.hasMedia = !negated;
          return true;
        case 'image':
        case 'photo':
          query.hasMedia = !negated;
          query.mediaType = 'image';
          return true;
        case 'video':
          query.hasMedia = !negated;
          query.mediaType = 'video';
          return true;
        default:
          return false;
      }

    case 'include':
      if (lower === 'deleted') {
        query.deleted = 'include';
        return true;
      }
      return false;

    case 'sort':
      if (lower === 'new' || lower === 'old' || lower === 'top') {
        query.sort = lower;
        return true;
      }
      return false;

    case 'limit': {
      const n = Number(value);
      if (Number.isNaN(n) || n <= 0) return false;
      query.limit = Math.min(n, 5000);
      return true;
    }

    default:
      return false;
  }
}

/** True when nothing was asked for — used to avoid running an unbounded scan. */
export function isEmptyQuery(query: ArchiveQuery): boolean {
  return (
    query.terms.length === 0 &&
    query.phrases.length === 0 &&
    query.excludedTerms.length === 0 &&
    query.excludedPhrases.length === 0 &&
    !query.author &&
    !query.group &&
    !query.since &&
    !query.until &&
    query.minScore === undefined &&
    query.maxScore === undefined &&
    !query.type &&
    query.isReply === undefined &&
    !query.deleted &&
    query.hasMedia === undefined
  );
}

/** Human-readable echo of what a query was understood to mean. */
export function describeQuery(query: ArchiveQuery): string[] {
  const parts: string[] = [];
  if (query.terms.length) parts.push(`words: ${query.terms.join(' + ')}`);
  if (query.phrases.length) parts.push(`phrase: ${query.phrases.map((p) => `“${p}”`).join(', ')}`);
  if (query.excludedTerms.length) parts.push(`without: ${query.excludedTerms.join(', ')}`);
  if (query.excludedPhrases.length)
    parts.push(`without phrase: ${query.excludedPhrases.map((p) => `“${p}”`).join(', ')}`);
  if (query.author) parts.push(`by @${query.author}`);
  if (query.group) parts.push(`in ${query.group}`);
  if (query.since) parts.push(`since ${query.since.slice(0, 10)}`);
  if (query.until) parts.push(`until ${query.until.slice(0, 10)}`);
  if (query.minScore !== undefined) parts.push(`score ≥ ${query.minScore}`);
  if (query.maxScore !== undefined) parts.push(`score ≤ ${query.maxScore}`);
  if (query.type) parts.push(query.type === 'post' ? 'posts only' : 'comments only');
  if (query.isReply !== undefined) parts.push(query.isReply ? 'replies only' : 'not replies');
  if (query.deleted === 'only') parts.push('deleted only');
  if (query.deleted === 'include') parts.push('including deleted');
  if (query.hasMedia) parts.push(query.mediaType ? `with ${query.mediaType}` : 'with media');
  if (query.sort !== 'new') parts.push(query.sort === 'top' ? 'highest score first' : 'oldest first');
  return parts;
}
