const supportsColor =
  process.env.NO_COLOR === undefined &&
  (process.env.FORCE_COLOR !== undefined || process.stdout.isTTY);

function wrap(code: number, value: string): string {
  return supportsColor ? `\u001B[${code}m${value}\u001B[0m` : value;
}

export const color = Object.freeze({
  red: (value: string): string => wrap(31, value),
  green: (value: string): string => wrap(32, value),
  yellow: (value: string): string => wrap(33, value),
  blue: (value: string): string => wrap(34, value),
  gray: (value: string): string => wrap(90, value),
  bold: (value: string): string => wrap(1, value),
});

export function formatTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  const render = (row: readonly string[]): string =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd();
  const separator = widths.map((width) => '-'.repeat(width)).join('  ');
  return [render(headers), separator, ...rows.map(render)].join('\n');
}

export function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);

  if (typeof value === 'symbol') return value.description ?? 'Symbol';
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) return value.message;

  try {
    const serialized: unknown = JSON.stringify(value);

    return typeof serialized === 'string' ? serialized : '[unserializable value]';
  } catch {
    return '[unserializable value]';
  }
}

export function redactValue(value: unknown): string {
  if (value === undefined) return '<missing>';
  if (value === null) return 'null';
  return '[REDACTED]';
}
