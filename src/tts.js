// Text-to-speech narration for screenwright tutorials.
//
// Turns each step's caption into a spoken clip (ElevenLabs or OpenAI), so the
// recorded tutorial has a real voice-over synced to the burned-in subtitles.
// Providers are configured with the SAME MCP config via env vars (or per-call
// `tts` overrides). Node 18+ (global fetch) required.

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const DEFAULTS = {
	elevenlabs: {
		model: 'eleven_multilingual_v2',      // handles EN + ES well
		voiceId: '21m00Tcm4TlvDq8ikWAM',      // "Rachel" (public default)
		stability: 0.5,
		similarityBoost: 0.75,
		style: 0,
		outputFormat: 'mp3_44100_128',
	},
	openai: {
		model: 'gpt-4o-mini-tts',
		voice: 'onyx',
	},
};

/**
 * Resolve the effective TTS config from per-call opts + env. Returns null when
 * narration is disabled (no provider + no key configured).
 *
 * Env (same MCP config):
 *   SCREENWRIGHT_TTS_PROVIDER = elevenlabs | openai
 *   ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL
 *   OPENAI_API_KEY, OPENAI_TTS_VOICE, OPENAI_TTS_MODEL
 * Per-call `tts` overrides any of: { provider, apiKey, voiceId, voice, model,
 *   speed, stability, similarityBoost, style, tailPadMs, gapMs }.
 *
 * @param {object|boolean|undefined} tts  per-call override (or `true` to enable with env)
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveTts(tts, env = process.env) {
	if(tts === false) return null;
	const o = (tts && typeof tts === 'object') ? tts : {};

	const provider = (o.provider || env.SCREENWRIGHT_TTS_PROVIDER || '').toLowerCase();
	// Enabled only when a provider is chosen AND we can find a key.
	if(provider !== 'elevenlabs' && provider !== 'openai') {
		// If a per-call tts object was passed without a provider, that's a user error.
		if(tts && typeof tts === 'object') throw new Error('tts.provider must be "elevenlabs" or "openai"');
		return null;
	}

	const speed = num(o.speed, 1);
	const tailPadMs = num(o.tailPadMs, 450);   // silence held after each line
	const gapMs = num(o.gapMs, 250);           // min gap the caller adds between lines

	if(provider === 'elevenlabs') {
		const apiKey = o.apiKey || env.ELEVENLABS_API_KEY;
		if(!apiKey) throw new Error('ElevenLabs selected but no API key (set ELEVENLABS_API_KEY or tts.apiKey)');
		return {
			provider, apiKey, speed, tailPadMs, gapMs,
			voiceId: o.voiceId || env.ELEVENLABS_VOICE_ID || DEFAULTS.elevenlabs.voiceId,
			model: o.model || env.ELEVENLABS_MODEL || DEFAULTS.elevenlabs.model,
			stability: num(o.stability, DEFAULTS.elevenlabs.stability),
			similarityBoost: num(o.similarityBoost, DEFAULTS.elevenlabs.similarityBoost),
			style: num(o.style, DEFAULTS.elevenlabs.style),
			outputFormat: o.outputFormat || DEFAULTS.elevenlabs.outputFormat,
		};
	}
	// openai
	const apiKey = o.apiKey || env.OPENAI_API_KEY;
	if(!apiKey) throw new Error('OpenAI selected but no API key (set OPENAI_API_KEY or tts.apiKey)');
	return {
		provider, apiKey, speed, tailPadMs, gapMs,
		voice: o.voice || env.OPENAI_TTS_VOICE || DEFAULTS.openai.voice,
		model: o.model || env.OPENAI_TTS_MODEL || DEFAULTS.openai.model,
	};
}

function num(v, d) { return (typeof v === 'number' && !Number.isNaN(v)) ? v : d; }

/**
 * Synthesize one line of narration into an mp3 file.
 * @returns {Promise<{file:string, durationMs:number}>}
 */
export async function synthesizeLine(cfg, text, file) {
	const bytes = cfg.provider === 'elevenlabs'
		? await ttsElevenLabs(cfg, text)
		: await ttsOpenAI(cfg, text);
	writeFileSync(file, Buffer.from(bytes));
	return { file, durationMs: probeDurationMs(file) };
}

async function ttsElevenLabs(cfg, text) {
	const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}?output_format=${encodeURIComponent(cfg.outputFormat)}`;
	const voiceSettings = {
		stability: cfg.stability,
		similarity_boost: cfg.similarityBoost,
		style: cfg.style,
		use_speaker_boost: true,
		...(cfg.speed && cfg.speed !== 1 ? { speed: cfg.speed } : {}),
	};
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'xi-api-key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
		body: JSON.stringify({ text, model_id: cfg.model, voice_settings: voiceSettings }),
	});
	if(!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
	return await res.arrayBuffer();
}

async function ttsOpenAI(cfg, text) {
	const res = await fetch('https://api.openai.com/v1/audio/speech', {
		method: 'POST',
		headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: cfg.model, voice: cfg.voice, input: text, response_format: 'mp3', speed: cfg.speed || 1 }),
	});
	if(!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
	return await res.arrayBuffer();
}

/** Duration of a media file in ms, parsed from ffmpeg's stderr (ffmpeg-static, no ffprobe needed). */
export function probeDurationMs(file) {
	const r = spawnSync(ffmpegPath, [ '-i', file ], { encoding: 'utf8' });
	const m = (r.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
	if(!m) return 0;
	const [ , h, mm, s, cs ] = m;
	return ((+h) * 3600 + (+mm) * 60 + (+s)) * 1000 + (+cs) * 10;
}

/**
 * Mix narration clips into a single wav, each delayed to its start time (ms).
 * Clips don't overlap (the driver holds the screen for each line), so a plain
 * summed amix (normalize=0) keeps every line at full volume.
 *
 * @param {Array<{file:string,startMs:number}>} clips
 * @param {string} outWav
 * @returns {string|null} outWav, or null if no clips.
 */
export function mixNarration(clips, outWav) {
	if(!clips || !clips.length) return null;
	const inputs = clips.flatMap((c) => [ '-i', c.file ]);
	const parts = clips.map((c, i) => `[${i}:a]adelay=${Math.max(0, Math.round(c.startMs))}|${Math.max(0, Math.round(c.startMs))}[a${i}]`);
	const labels = clips.map((_, i) => `[a${i}]`).join('');
	const filter = clips.length === 1
		? `${parts[0]};[a0]aresample=44100[mix]`
		: `${parts.join(';')};${labels}amix=inputs=${clips.length}:normalize=0,aresample=44100[mix]`;
	const r = spawnSync(ffmpegPath, [ '-y', ...inputs, '-filter_complex', filter, '-map', '[mix]', '-c:a', 'pcm_s16le', outWav ], { stdio: 'ignore' });
	if(r.status !== 0) throw new Error('ffmpeg narration mix failed');
	return outWav;
}
