import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve, basename, extname } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { toSrt } from './srt.js';
import { resolveTts, synthesizeLine, mixNarration } from './tts.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveAdb(adbPath) {
	if(adbPath) return adbPath;
	for(const env of [ 'ANDROID_HOME', 'ANDROID_SDK_ROOT' ]) {
		const base = process.env[env];
		if(base) { const p = join(base, 'platform-tools', 'adb'); if(existsSync(p)) return p; }
	}
	const guess = join(homedir(), 'Android', 'Sdk', 'platform-tools', 'adb');
	return existsSync(guess) ? guess : 'adb';
}

const KEYS = { BACK: 'KEYCODE_BACK', HOME: 'KEYCODE_HOME', ENTER: 'KEYCODE_ENTER', TAB: 'KEYCODE_TAB', MENU: 'KEYCODE_MENU', APP_SWITCH: 'KEYCODE_APP_SWITCH' };
const keycode = (k) => (KEYS[String(k).toUpperCase()] || k);

/**
 * Record a subtitled tutorial of an Android app (incl. Flutter) on a running
 * emulator/device. Captions can't be injected into a native app, so the screen is
 * recorded with `adb screenrecord` and the captions are burned in afterwards with
 * ffmpeg (libass) from the synced .srt.
 *
 * @param {object} opts
 * @param {Array}  opts.steps   tap / text / swipe / key / launch / wait (+ optional caption).
 * @param {string} opts.output  output .mp4.
 * @param {string} [opts.serial] adb device serial (-s) when several are connected.
 * @param {number} [opts.bitRate=8000000]
 * @param {string} [opts.size]   recording size "WxH" (default: device resolution).
 * @param {string} [opts.srt]    custom .srt path.
 * @param {boolean}[opts.burnIn=true] burn captions into the mp4.
 * @param {object} [opts.captionStyle] { fontSize, marginV, primary, box }.
 * @param {string} [opts.adbPath]
 */
export async function recordAndroidTutorial(opts = {}) {
	const {
		steps, output, serial, bitRate = 8_000_000, size,
		srt: srtPath, burnIn = true, captionStyle = {}, adbPath, startupMs = 900,
		tts,
	} = opts;

	const ttsCfg = resolveTts(tts);

	if(!Array.isArray(steps) || steps.length === 0) throw new Error('`steps` (non-empty array) is required');
	if(!output) throw new Error('`output` (path to .mp4) is required');

	const adb = resolveAdb(adbPath);
	const pre = serial ? [ '-s', serial ] : [];
	const run = (args) => spawnSync(adb, [ ...pre, ...args ], { encoding: 'utf8' });

	const state = run([ 'get-state' ]);
	if(state.status !== 0 || !/device/.test(state.stdout || '')) {
		throw new Error(`No Android device/emulator connected (adb: ${adb}). Start your emulator (e.g. \`flutter emulators --launch <id>\` or \`emulator -avd <name>\`) and retry.`);
	}

	const outAbs = resolve(output);
	mkdirSync(dirname(outAbs), { recursive: true });
	const tmp = mkdtempSync(join(tmpdir(), 'screenwright-android-'));
	const devicePath = '/sdcard/screenwright_rec.mp4';
	run([ 'shell', 'rm', '-f', devicePath ]);

	// Pre-synthesize narration BEFORE recording, so network latency isn't filmed and
	// we know each line's duration (to hold the screen while the voice plays).
	const audioByIndex = new Map();
	if(ttsCfg) {
		for(let i = 0; i < steps.length; i++) {
			const s = steps[i];
			const line = (s.narration ?? s.caption);
			if(s.caption !== undefined && line && String(line).trim()) {
				audioByIndex.set(i, await synthesizeLine(ttsCfg, String(line).trim(), join(tmp, `narr-${i}.mp3`)));
			}
		}
	}

	const srArgs = [ ...pre, 'shell', 'screenrecord', '--bit-rate', String(bitRate), ...(size ? [ '--size', size ] : []), devicePath ];
	const rec = spawn(adb, srArgs, { stdio: 'ignore' });
	await sleep(startupMs); // let screenrecord warm up before t0

	const cues = [];
	let openCue = null;
	const t0 = Date.now();
	const now = () => Date.now() - t0;
	const setCaption = (text) => {
		if(openCue) { cues.push({ ...openCue, end: now() }); openCue = null; }
		if(text) openCue = { start: now(), text };
	};

	try {
		for(let i = 0; i < steps.length; i++) {
			const step = steps[i];
			if(step.caption !== undefined) setCaption(step.caption);
			const audio = audioByIndex.get(i);
			if(audio && openCue) openCue.audioFile = audio.file; // carried into the cue for mixing
			runAndroidAction(run, step);
			// Hold the screen at least as long as this line's narration (+ tail), so the
			// voice-over finishes before the next caption/line begins.
			const dwell = Math.max(step.dwellMs || 0, audio ? audio.durationMs + ttsCfg.tailPadMs : 0);
			if(dwell) await sleep(dwell);
		}
	} finally {
		if(openCue) { openCue.end = now(); cues.push(openCue); }
	}

	// stop screenrecord cleanly: SIGINT on-device finalizes the mp4
	run([ 'shell', 'kill -2 $(pidof screenrecord)' ]);
	await sleep(1500);
	rec.kill();

	const localRaw = join(tmp, 'raw.mp4');
	const pull = run([ 'pull', devicePath, localRaw ]);
	if(pull.status !== 0 || !existsSync(localRaw)) throw new Error('failed to pull the recording from the device');
	run([ 'shell', 'rm', '-f', devicePath ]);

	const srtAbs = srtPath ? resolve(srtPath) : join(dirname(outAbs), `${basename(outAbs, extname(outAbs))}.captions.srt`);
	writeFileSync(srtAbs, toSrt(cues));

	// Mix the narration clips (each delayed to its caption's start) into one track.
	const clips = cues.filter((c) => c.audioFile).map((c) => ({ file: c.audioFile, startMs: c.start }));
	const narrationWav = (ttsCfg && clips.length) ? mixNarration(clips, join(tmp, 'narration.wav')) : null;

	const vf = burnIn && cues.length ? [ '-vf', `subtitles=${srtAbs}:force_style=${assStyle(captionStyle)}` ] : [];
	const ffArgs = narrationWav
		? [ '-y', '-i', localRaw, '-i', narrationWav, ...vf, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outAbs ]
		: [ '-y', '-i', localRaw, ...vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outAbs ];
	const conv = spawnSync(ffmpegPath, ffArgs, { stdio: 'ignore' });
	if(conv.status !== 0) throw new Error('ffmpeg conversion/caption-burn failed');

	return {
		mp4: outAbs, srt: srtAbs, durationMs: now(), steps: steps.length, captions: cues.length,
		device: (state.stdout || '').trim(),
		narration: narrationWav ? { provider: ttsCfg.provider, lines: clips.length } : null,
	};
}

function runAndroidAction(run, step) {
	switch(step.action) {
		case 'tap': run([ 'shell', 'input', 'tap', String(step.x), String(step.y) ]); break;
		case 'text': run([ 'shell', 'input', 'text', String(step.text ?? '').replace(/ /g, '%s') ]); break;
		case 'swipe': run([ 'shell', 'input', 'swipe', String(step.x1), String(step.y1), String(step.x2), String(step.y2), String(step.durationMs ?? 300) ]); break;
		case 'key': run([ 'shell', 'input', 'keyevent', keycode(step.key) ]); break;
		case 'launch':
			if(step.activity) run([ 'shell', 'am', 'start', '-n', `${step.package}/${step.activity}` ]);
			else run([ 'shell', 'monkey', '-p', step.package, '-c', 'android.intent.category.LAUNCHER', '1' ]);
			break;
		case 'wait': break; // dwell handled by step.dwellMs
		default: throw new Error(`unknown android action "${step.action}"`);
	}
}

// ASS force_style for the burned-in caption bar (libass). Colours are &HAABBGGRR.
function assStyle(s = {}) {
	const fontSize = s.fontSize ?? 16;
	const marginV = s.marginV ?? 44;
	const primary = s.primary ?? '&H00FFFFFF&'; // white
	const back = s.box ?? '&H99000000&';        // ~60% black box
	return `FontName=DejaVu Sans,FontSize=${fontSize},Bold=1,PrimaryColour=${primary},BorderStyle=4,BackColour=${back},Outline=0,Shadow=0,Alignment=2,MarginV=${marginV}`;
}
