// Run a steps JSON directly (no MCP) — handy for testing.
//   node scripts/run-example.js [path/to/steps.json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recordTutorial } from '../src/recorder.js';

const file = process.argv[2] || fileURLToPath(new URL('../examples/demo.json', import.meta.url));
const opts = JSON.parse(readFileSync(file, 'utf8'));

console.log(`Recording from ${file} …`);
const result = await recordTutorial(opts);
console.log('Done:', result);
