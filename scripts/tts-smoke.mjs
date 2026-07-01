// Smoke test for the TTS module. Reads the key from env (or --key file) and
// synthesizes one line, printing the resulting file + duration.
//   ELEVENLABS_API_KEY=... node scripts/tts-smoke.mjs "Hola, esto es Signara."
import { resolveTts, synthesizeLine } from '../src/tts.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const text = process.argv[2] || 'Hola, esto es Signara — tu copiloto de mercado con inteligencia artificial.';
const provider = process.env.SCREENWRIGHT_TTS_PROVIDER || (process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'openai');
const cfg = resolveTts({ provider });
if(!cfg) { console.error('No TTS provider/key configured.'); process.exit(1); }

const out = join(mkdtempSync(join(tmpdir(), 'sw-tts-')), 'line.mp3');
const r = await synthesizeLine(cfg, text, out);
console.log(JSON.stringify({ provider: cfg.provider, ...r }, null, 2));
