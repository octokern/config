import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { color, formatValue } from '../format.js';
import type { CommandContext } from './shared.js';
import { getOutPath, loadDefinitions } from './shared.js';
import { getOptionString, hasOption } from '../args.js';

function escapeCell(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  return formatValue(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function renderConfigDocs(fields: ReturnType<Awaited<ReturnType<typeof loadDefinitions>>[number]['describeFields']>): string {
  const lines = [
    '| Название | Переменная | Обязательна | Тип | По умолчанию | Секрет | Описание |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const field of fields) {
    const type = field.enumValues?.length
      ? `enum: ${field.enumValues.map(formatValue).join(', ')}`
      : field.type;
    lines.push(`| ${escapeCell(field.name)} | \`${escapeCell(field.key)}\` | ${field.required ? 'Да' : 'Нет'} | ${escapeCell(type)} | ${escapeCell(field.defaultValue)} | ${field.secret ? 'Да' : 'Нет'} | ${escapeCell(field.description)} |`);
  }
  return `${lines.join('\n')}\n`;
}

export async function docsCommand(context: CommandContext): Promise<void> {
  const definitions = await loadDefinitions(context);
  const fields = definitions.flatMap((definition) => definition.describeFields());
  const markdown = renderConfigDocs(fields);
  const injectFile = getOptionString(context.args.options, 'inject');
  if (injectFile) {
    const filePath = getOutPath({ ...context.args, options: { ...context.args.options, out: injectFile } }, injectFile);
    if (!existsSync(filePath)) throw new Error(`Cannot inject docs: file not found: ${filePath}`);
    const original = readFileSync(filePath, 'utf8');
    const start = '<!-- fastconfig:start -->';
    const end = '<!-- fastconfig:end -->';
    const startIndex = original.indexOf(start);
    const endIndex = original.indexOf(end);
    if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
      throw new Error(`Injection markers must appear in order: ${start} and ${end}`);
    }
    const updated = `${original.slice(0, startIndex + start.length)}\n${markdown}${original.slice(endIndex)}`;
    writeFileSync(filePath, updated, 'utf8');
    console.log(color.green(`Injected configuration docs into ${filePath}`));
    return;
  }
  if (hasOption(context.args.options, 'stdout')) {
    console.log(markdown);
    return;
  }
  const outputPath = getOutPath(context.args, 'ENV.md');
  writeFileSync(outputPath, markdown, 'utf8');
  console.log(color.green(`Generated ${outputPath}`));
}
