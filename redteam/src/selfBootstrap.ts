import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function resolveExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function bootstrapSelfLexicon(): Promise<{ loaded: boolean; lexiconSize: number; source?: string; target?: string }> {
  const projectRoot = process.cwd();
  const targetLexiconPath = path.resolve(projectRoot, 'node_modules/self-engine/dist/lexicon.json');

  if (!fs.existsSync(targetLexiconPath)) {
    const source = resolveExistingPath([
      path.resolve(projectRoot, '../SELF/SELF/src/lexicon.json'),
      path.resolve(projectRoot, '../SELF/SELF/dist/lexicon.json'),
      path.resolve(projectRoot, '../../SELF/SELF/src/lexicon.json'),
    ]);

    if (source) {
      fs.mkdirSync(path.dirname(targetLexiconPath), { recursive: true });
      fs.copyFileSync(source, targetLexiconPath);
    }
  }

  const configModulePath = path.resolve(projectRoot, 'node_modules/self-engine/dist/config.js');
  const mod = await import(pathToFileURL(configModulePath).href);

  if (typeof mod.reloadLexicon === 'function') {
    mod.reloadLexicon();
  }

  const lexicon = typeof mod.getLexicon === 'function' ? mod.getLexicon() : null;
  const lexiconSize = lexicon && Array.isArray(lexicon.selfHarm) ? lexicon.selfHarm.length : 0;

  return {
    loaded: lexiconSize > 0,
    lexiconSize,
    target: targetLexiconPath,
  };
}
