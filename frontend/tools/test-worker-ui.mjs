import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
// Keep external package resolution beside frontend/node_modules, remove on completion.
const dir = await mkdtemp(join(process.cwd(), '.worker-ui-test-'));
try {
  const result = await build({ entryPoints: ['tests/worker-ui.test.tsx'], bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', write: false, define: { 'import.meta.env': '{}' } });
  const file = join(dir, 'worker-ui.test.mjs');
  await writeFile(file, result.outputFiles[0].contents);
  const run = spawnSync(process.execPath, ['--test', file], { stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally { await rm(dir, { recursive: true, force: true }); }
