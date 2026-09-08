import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReviewServer } from './serve.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
async function run(script, args = [], env = process.env) {
  const child = spawn('npm', ['run', script, ...args], { cwd, env, stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${script} failed (${signal || code}).`);
}

// Build before starting the server: its cached validator must match the tested source.
for (const script of ['format:check', 'typecheck', 'test', 'test:export', 'build'])
  await run(script);
const server = createReviewServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const env = { ...process.env, BEAT_BLOOM_QA_ORIGIN: `http://127.0.0.1:${server.address().port}` };
// A full verification must not inherit a developer's single-case filter or old receipt.
delete env.BEAT_BLOOM_QA_CASE;
delete env.BEAT_BLOOM_QA_RECEIPT;
const outputRoot = env.BEAT_BLOOM_QA_OUTPUT || resolve(cwd, 'qa/native/latest');
const qaEnv = (folder) => ({ ...env, BEAT_BLOOM_QA_OUTPUT: resolve(outputRoot, folder) });
try {
  await run('qa', ['--', '--production'], qaEnv('runtime'));
  for (const [script, folder] of [
    ['qa:export', 'export'],
    ['qa:endcard', 'endcard'],
    ['qa:patterns', 'patterns'],
  ])
    await run(script, [], qaEnv(folder));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
