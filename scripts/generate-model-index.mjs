import { readdir, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

const modelsDir = join(process.cwd(), 'public', 'models');
const outputPath = join(modelsDir, 'index.json');

const entries = await readdir(modelsDir, { withFileTypes: true });
const models = entries
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.glb')
  .map((entry) => basename(entry.name, '.glb').toLowerCase())
  .sort((a, b) => a.localeCompare(b));

await writeFile(outputPath, `${JSON.stringify(models, null, 2)}\n`, 'utf8');
console.log(`Generated ${outputPath} with ${models.length} model(s).`);
