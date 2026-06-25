import { chromium } from 'playwright';
import { writeFileSync, readdirSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { toSrt } from './srt.js';

/**
 * Record a subtitled tutorial video by driving a browser through a list of steps.
 * Captions are injected as an on-page overlay (burned into the video) and synced to
 * each step; a matching .srt sidecar is also written.
 *
 * @param {object} opts
 * @param {Array}  opts.steps      Ordered steps (see runAction for actions).
 * @param {string} opts.output     Path to the output .mp4.
 * @param {string} [opts.baseUrl]  Base URL for relative goto paths.
 * @param {{width:number,height:number}} [opts.viewport]
 * @param {boolean} [opts.headless=true]
 * @param {string} [opts.channel]  Browser channel (e.g. 'chrome') — default bundled chromium.
 * @param {boolean} [opts.burnIn=true]  Burn captions into the video (overlay).
 * @param {string} [opts.srt]      Custom path for the .srt sidecar.
 * @param {object} [opts.captionStyle]  { position, fontSize, bg, color, maxWidth }.
 * @returns {Promise<{mp4,srt,durationMs,steps,captions}>}
 */
export async function recordTutorial(opts = {}) {
	const {
		steps, output, baseUrl,
		viewport = { width: 1440, height: 900 },
		headless = true, channel,
		burnIn = true, srt: srtPath, captionStyle = {},
	} = opts;

	if(!Array.isArray(steps) || steps.length === 0) throw new Error('`steps` (non-empty array) is required');
	if(!output) throw new Error('`output` (path to .mp4) is required');

	const outAbs = resolve(output);
	mkdirSync(dirname(outAbs), { recursive: true });
	const tmpDir = mkdtempSync(join(tmpdir(), 'screenwright-'));

	const browser = await chromium.launch({ headless, channel });
	const context = await browser.newContext({
		viewport,
		baseURL: baseUrl,
		recordVideo: { dir: tmpDir, size: viewport },
	});
	const page = await context.newPage();

	if(burnIn) {
		await page.addInitScript((style) => {
			const s = Object.assign({ position: 'bottom', fontSize: 23, bg: 'rgba(12,12,16,.9)', color: '#fff', maxWidth: 84 }, style || {});
			const ensure = () => {
				if(document.getElementById('sw-cap')) return;
				const pos = s.position === 'top' ? 'top:6%;' : 'bottom:6%;';
				const st = document.createElement('style');
				st.textContent = `#sw-cap{position:fixed;left:50%;${pos}transform:translateX(-50%);max-width:${s.maxWidth}%;padding:15px 30px;border-radius:15px;background:${s.bg};color:${s.color};font-size:${s.fontSize}px;font-weight:600;font-family:system-ui,-apple-system,sans-serif;text-align:center;z-index:2147483647;box-shadow:0 10px 50px rgba(0,0,0,.55);opacity:0;transition:opacity .3s ease;line-height:1.45;pointer-events:none;border:1px solid rgba(255,255,255,.14)}#sw-cap.show{opacity:1}`;
				document.documentElement.appendChild(st);
				const d = document.createElement('div'); d.id = 'sw-cap';
				(document.body || document.documentElement).appendChild(d);
				window.__swCap = (t) => {
					const e = document.getElementById('sw-cap'); if(!e) return;
					if(t) { e.textContent = t; e.classList.add('show'); } else { e.classList.remove('show'); }
				};
			};
			if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure);
			else ensure();
			setTimeout(ensure, 400);
		}, captionStyle);
	}

	const cues = [];
	let openCue = null;
	const t0 = Date.now();
	const now = () => Date.now() - t0;

	const setCaption = async (text) => {
		if(openCue) { cues.push({ ...openCue, end: now() }); openCue = null; }
		if(burnIn) await page.evaluate((t) => window.__swCap && window.__swCap(t), text || '').catch(() => {});
		if(text) openCue = { start: now(), text };
	};

	for(const step of steps) {
		if(step.caption !== undefined) await setCaption(step.caption);
		try {
			await runAction(page, step);
		} catch(err) {
			if(!step.optional) { await context.close().catch(() => {}); await browser.close().catch(() => {}); throw new Error(`step "${step.action}" failed: ${err.message}`); }
		}
		if(step.dwellMs) await page.waitForTimeout(step.dwellMs);
	}
	if(openCue) { openCue.end = now(); cues.push(openCue); }
	const durationMs = now();

	await context.close();
	await browser.close();

	const webm = readdirSync(tmpDir).filter((f) => f.endsWith('.webm')).map((f) => join(tmpDir, f))[0];
	if(!webm) throw new Error('no video was recorded');

	const conv = spawnSync(ffmpegPath, [ '-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outAbs ], { stdio: 'ignore' });
	if(conv.status !== 0) throw new Error('ffmpeg conversion to mp4 failed');

	const srtAbs = srtPath
		? resolve(srtPath)
		: join(dirname(outAbs), `${basename(outAbs, extname(outAbs))}.captions.srt`);
	writeFileSync(srtAbs, toSrt(cues));

	return { mp4: outAbs, srt: srtAbs, durationMs, steps: steps.length, captions: cues.length };
}

async function runAction(page, step) {
	const timeout = step.timeoutMs ?? 8000;
	switch(step.action) {
		case 'goto':
			await page.goto(step.url, { waitUntil: 'load' });
			await page.waitForLoadState('networkidle').catch(() => {});
			break;
		case 'click': await page.locator(step.selector).first().click({ timeout }); break;
		case 'fill': await page.locator(step.selector).first().fill(step.text ?? '', { timeout }); break;
		case 'type': await page.locator(step.selector).first().pressSequentially(step.text ?? '', { delay: step.delayMs ?? 110, timeout }); break;
		case 'press': await page.keyboard.press(step.key); break;
		case 'hover': await page.locator(step.selector).first().hover({ timeout }); break;
		case 'scroll': await page.mouse.wheel(0, step.deltaY ?? 300); break;
		case 'wait': break; // dwell handled by step.dwellMs
		default: throw new Error(`unknown action "${step.action}"`);
	}
}
