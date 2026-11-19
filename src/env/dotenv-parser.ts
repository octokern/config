import type { RawEnvironment } from '../types/env.types.js';

export interface ParsedDotenv {
  readonly values: Readonly<RawEnvironment>;
  readonly singleQuoted: ReadonlySet<string>;
}

type Quote = 'single' | 'double' | 'backtick' | 'none';

function decodeDoubleQuoted(value: string): string {
  return value.replace(/\\(n|r|t|\\|")/g, (_match, escaped: string) => {
    switch (escaped) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case '\\': return '\\';
      case '"': return '"';
      default: return escaped;
    }
  });
}

function stripInlineComment(value: string): string {
  return value.replace(/\s+#.*$/, '').trimEnd();
}

function findClosingQuote(value: string, quote: string): number {
  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote === '"') {
      escaped = true;
      continue;
    }
    if (character === quote) return index;
  }
  return -1;
}

function parseAssignment(line: string): { readonly key: string; readonly value: string; readonly quote: Quote; readonly complete: boolean } | undefined {
  const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  const key = assignment?.[1];
  const raw = assignment?.[2];
  if (!key || raw === undefined) return undefined;
  const first = raw[0];
  if (first === "'" || first === '"' || first === '`') {
    const closeIndex = findClosingQuote(raw, first);
    if (closeIndex < 0) return { key, value: raw.slice(1), quote: first === "'" ? 'single' : first === '"' ? 'double' : 'backtick', complete: false };
    const content = raw.slice(1, closeIndex);
    const trailing = raw.slice(closeIndex + 1).trim();
    const value = first === '"' ? decodeDoubleQuoted(content) : content;
    return { key, value, quote: first === "'" ? 'single' : first === '"' ? 'double' : 'backtick', complete: !trailing || trailing.startsWith('#') };
  }
  return { key, value: stripInlineComment(raw).trim(), quote: 'none', complete: true };
}

export function parseDotenvDetailed(content: string): ParsedDotenv {
  const input = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const values: RawEnvironment = {};
  const singleQuoted = new Set<string>();
  const lines = input.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const parsed = parseAssignment(line);
    if (!parsed) continue;
    let value = parsed.value;
    if (!parsed.complete && parsed.quote !== 'none') {
      const delimiter = parsed.quote === 'single' ? "'" : parsed.quote === 'double' ? '"' : '`';
      let closed = false;
      while (index + 1 < lines.length) {
        index += 1;
        const next = lines[index] ?? '';
        const closeAt = findClosingQuote(`${delimiter}${next}`, delimiter) - 1;
        if (closeAt >= 0) {
          value += `\n${next.slice(0, closeAt)}`;
          closed = true;
          break;
        }
        value += `\n${next}`;
      }
      if (!closed) {
        // Keep an unterminated quoted value as-is. The validator can report it later.
      }
      if (parsed.quote === 'double') value = decodeDoubleQuoted(value);
    }
    values[parsed.key] = value;
    if (parsed.quote === 'single') singleQuoted.add(parsed.key);
  }
  return { values: Object.freeze(values), singleQuoted };
}

export function parseDotenv(content: string): RawEnvironment {
  return { ...parseDotenvDetailed(content).values };
}
