function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j] ?? 0;
  }

  return previous[right.length] ?? Number.MAX_SAFE_INTEGER;
}

export function findClosestKey(missingKey: string, providedKeys: readonly string[]): string | undefined {
  const normalized = missingKey.toLowerCase();
  let candidate: string | undefined;
  let bestDistance = Number.MAX_SAFE_INTEGER;

  for (const key of providedKeys) {
    const distance = levenshtein(normalized, key.toLowerCase());
    const keyLength = Math.max(normalized.length, key.length);
    // Short environment identifiers need a tolerance of two edits:
    // e.g. PORT -> PRTO has Levenshtein distance 2.
    const threshold = Math.max(1, Math.min(3, Math.floor(keyLength / 2)));

    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance;
      candidate = key;
    }
  }

  return candidate;
}

export function withTypoSuggestion(message: string, missingKey: string, providedKeys: readonly string[]): string {
  const suggestion = findClosestKey(missingKey, providedKeys);
  return suggestion ? `${message} (did you mean "${suggestion}"?)` : message;
}
