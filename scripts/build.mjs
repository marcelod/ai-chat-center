// Builds the installable plugin: bundles the hook/waiter/hub entries and the web UI into plugin/dist.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'plugin', 'dist');

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    hook: path.join(root, 'src/bin/hook.ts'),
    waiter: path.join(root, 'src/bin/waiter.ts'),
    hub: path.join(root, 'src/bin/hub.ts'),
  },
  outdir: dist,
  bundle: true,
  platform: 'node',
  format: 'esm',
  // The plugin runs on whatever Node is on PATH (18+), with no package.json: .mjs makes the ESM explicit.
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  banner: { js: "import { createRequire as __acc_createRequire } from 'node:module';\nconst require = __acc_createRequire(import.meta.url);" },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'info',
});

// Always a production build, even when invoked under vitest (NODE_ENV=test would bundle React's dev build).
// Run the Vite build through npm's own entry point (no shell, works on Windows).
const npmCli = process.env.npm_execpath;
const [cmd, args] = npmCli && /npm-cli\.c?js$/.test(npmCli)
  ? [process.execPath, [npmCli, '-w', 'ui', 'run', 'build']]
  : [process.platform === 'win32' ? 'npm.cmd' : 'npm', ['-w', 'ui', 'run', 'build']];
const ui = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' }, shell: !npmCli && process.platform === 'win32' });
if (ui.status !== 0) {
  console.error('UI build failed', ui.error ?? '');
  process.exit(ui.status ?? 1);
}

await fs.cp(path.join(root, 'ui', 'dist'), path.join(dist, 'ui'), { recursive: true });
console.log('plugin/dist ready');
