import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let count = 0;
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(m?js)$/.test(file)) {
      execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      const source = await fs.readFile(file, 'utf8');
      const imports = [...source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)];
      for (const [, specifier] of imports) await fs.access(path.resolve(path.dirname(file), specifier));
      count++;
    }
  }
}
for (const directory of ['src', 'scripts', 'tests']) await walk(directory);
execFileSync(process.execPath, ['--check', 'vite.config.js'], { stdio: 'inherit' });
console.log(`Checked ${count + 1} JavaScript modules and all relative imports.`);
