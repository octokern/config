import fs from 'node:fs';
import path from 'node:path';

const esmPkgPath = path.resolve('dist/esm/package.json');
const cjsPkgPath = path.resolve('dist/cjs/package.json');

fs.mkdirSync(path.dirname(esmPkgPath), { recursive: true });
fs.mkdirSync(path.dirname(cjsPkgPath), { recursive: true });
fs.writeFileSync(esmPkgPath, JSON.stringify({ type: 'module' }, null, 2));
fs.writeFileSync(cjsPkgPath, JSON.stringify({ type: 'commonjs' }, null, 2));

for (const file of ['bin/fastconfig.mjs', 'bin/octokernconfig.mjs']) {
  const binPath = path.resolve(file);
  if (!fs.existsSync(binPath)) continue;

  try {
    fs.chmodSync(binPath, 0o755);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}

console.log('Postbuild: ESM/CJS package metadata generated and CLI permissions updated.');
