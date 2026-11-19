import fs from 'node:fs';
import path from 'node:path';

const packagePath = path.resolve('package.json');
const sourcePath = path.resolve('src/cli/version.ts');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const validVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

if (typeof packageJson.version !== 'string' || !validVersion.test(packageJson.version)) {
  throw new TypeError(`Invalid package version: ${String(packageJson.version)}`);
}

const source = [
  `export const CLI_NAME: string = '@octokern/config';`,
  `export const CLI_VERSION: string = '${packageJson.version}';`,
  '',
].join('\n');

fs.writeFileSync(sourcePath, source);
console.log(`Synchronized CLI version to ${packageJson.version}.`);
