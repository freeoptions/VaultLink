import { strict as assert } from 'node:assert';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['tests/theme.test.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});

const code = result.outputFiles[0].text;
const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
await import(url);

assert.ok(true);
