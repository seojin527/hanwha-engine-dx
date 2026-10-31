// Bundle the Vite module for Node without a browser or a running backend.
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = await mkdtemp(join(tmpdir(), 'assembly-fit-'));
try {
  const result = await build({
    entryPoints: ['tests/assemblyFit.test.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
    define: { 'import.meta.env': '{}', 'window.location.origin': '"http://test.local"' },
  });
  const file = join(dir, 'assemblyFit.test.mjs');
  await writeFile(file, result.outputFiles[0].contents);
  const run = spawnSync(process.execPath, ['--test', file], { stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally { await rm(dir, { recursive: true, force: true }); }
