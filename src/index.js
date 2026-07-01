#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { recordTutorial } from './recorder.js';
import { recordAndroidTutorial } from './android.js';

const server = new McpServer({ name: 'screenwright', version: '0.1.0' });

// Optional voice-over. Configure once via the MCP env (SCREENWRIGHT_TTS_PROVIDER +
// ELEVENLABS_API_KEY/VOICE_ID/MODEL or OPENAI_API_KEY/TTS_VOICE/TTS_MODEL); pass this
// object to override per call. When set, each caption is spoken (real voice) and the
// screen is held while the line plays, so audio stays synced to the burned-in subs.
const ttsShape = z.object({
	provider: z.enum([ 'elevenlabs', 'openai' ]).describe('TTS provider.'),
	apiKey: z.string().optional().describe('Override the env API key.'),
	voiceId: z.string().optional().describe('ElevenLabs voice id.'),
	voice: z.string().optional().describe('OpenAI voice (e.g. onyx, nova, alloy).'),
	model: z.string().optional().describe('Provider model (e.g. eleven_multilingual_v2, gpt-4o-mini-tts).'),
	speed: z.number().optional().describe('Speaking rate (1 = normal).'),
	stability: z.number().optional().describe('ElevenLabs stability 0–1.'),
	similarityBoost: z.number().optional().describe('ElevenLabs similarity boost 0–1.'),
	style: z.number().optional().describe('ElevenLabs style 0–1.'),
	tailPadMs: z.number().optional().describe('Silence held after each line (ms). Default 450.'),
}).describe('Optional voice-over (ElevenLabs or OpenAI). Speaks each caption; omit to keep silent captions.');

const stepShape = z.object({
	caption: z.string().optional().describe('Subtitle to show during this step (stays until the next caption). Burned into the video + written to the .srt.'),
	narration: z.string().optional().describe('Spoken line for TTS when it should differ from the on-screen caption. Defaults to the caption text.'),
	action: z.enum([ 'goto', 'click', 'fill', 'type', 'press', 'hover', 'scroll', 'wait' ]).describe('What to do.'),
	url: z.string().optional().describe('For "goto": URL or path (relative to baseUrl).'),
	selector: z.string().optional().describe('For click/fill/type/hover: a Playwright selector — CSS, "text=…", "xpath=…", or ":has-text(…)".'),
	text: z.string().optional().describe('For fill/type: the text to enter.'),
	key: z.string().optional().describe('For press: a key, e.g. "Enter", "Escape".'),
	deltaY: z.number().optional().describe('For scroll: vertical wheel delta (px).'),
	delayMs: z.number().optional().describe('For type: per-keystroke delay (ms).'),
	timeoutMs: z.number().optional().describe('Per-action timeout (ms). Default 8000.'),
	dwellMs: z.number().optional().describe('How long to stay after the action (ms) — also how long the caption lingers.'),
	optional: z.boolean().optional().describe('If true, a failing action is skipped instead of aborting.'),
});

server.registerTool(
	'record_tutorial',
	{
		title: 'Record a subtitled tutorial video',
		description:
			'Drives a browser (Playwright) through an ordered list of steps, burning a synced subtitle bar into the recording and emitting a matching .srt. Great for product demos, onboarding and walkthroughs. Returns the paths to the .mp4 and .srt.',
		inputSchema: {
			output: z.string().describe('Path to the output .mp4 file.'),
			steps: z.array(stepShape).min(1).describe('Ordered steps. Put a "caption" on the steps where the narration should change.'),
			baseUrl: z.string().optional().describe('Base URL so "goto" steps can use relative paths.'),
			viewport: z.object({ width: z.number(), height: z.number() }).optional().describe('Video size. Default 1440x900.'),
			headless: z.boolean().optional().describe('Run headless. Default true.'),
			channel: z.string().optional().describe('Browser channel, e.g. "chrome", to use the system browser instead of bundled Chromium.'),
			burnIn: z.boolean().optional().describe('Burn captions into the video. Default true. If false, only the .srt is produced (clean video).'),
			srt: z.string().optional().describe('Custom path for the .srt sidecar. Default: <output>.captions.srt (a non-matching name so players do not double it on top of the burned-in subs).'),
			tts: ttsShape.optional(),
			captionStyle: z
				.object({
					position: z.enum([ 'bottom', 'top' ]).optional(),
					fontSize: z.number().optional(),
					bg: z.string().optional(),
					color: z.string().optional(),
					maxWidth: z.number().optional(),
				})
				.optional()
				.describe('Subtitle bar styling.'),
		},
	},
	async (args) => {
		try {
			const result = await recordTutorial(args);
			return {
				content: [ { type: 'text', text: `✅ Tutorial recorded.\n${JSON.stringify(result, null, 2)}` } ],
			};
		} catch(err) {
			return {
				isError: true,
				content: [ { type: 'text', text: `❌ ${err.message}` } ],
			};
		}
	},
);

const androidStepShape = z.object({
	caption: z.string().optional().describe('Subtitle shown during this step (burned into the video + .srt).'),
	narration: z.string().optional().describe('Spoken line for TTS when it should differ from the on-screen caption. Defaults to the caption text.'),
	action: z.enum([ 'tap', 'text', 'swipe', 'key', 'launch', 'wait' ]).describe('What to do on the device.'),
	x: z.number().optional().describe('tap: x (px).'),
	y: z.number().optional().describe('tap: y (px).'),
	x1: z.number().optional(), y1: z.number().optional(),
	x2: z.number().optional(), y2: z.number().optional(),
	durationMs: z.number().optional().describe('swipe: duration (ms).'),
	text: z.string().optional().describe('text: string to type.'),
	key: z.string().optional().describe('key: BACK | HOME | ENTER | MENU | APP_SWITCH | KEYCODE_*.'),
	package: z.string().optional().describe('launch: app package id.'),
	activity: z.string().optional().describe('launch: optional explicit activity.'),
	dwellMs: z.number().optional().describe('How long to stay after the action (ms).'),
});

server.registerTool(
	'record_android_tutorial',
	{
		title: 'Record a subtitled tutorial of an Android / Flutter app',
		description:
			'Drives a running Android emulator/device with adb (taps, text, swipes, keys, app launch), records the screen, and burns synced captions into the video (+ .srt). Works with any app, including Flutter — no app source needed. Requires the Android platform-tools (adb) and a running emulator or connected device. Coordinates are in device pixels.',
		inputSchema: {
			output: z.string().describe('Path to the output .mp4 file.'),
			steps: z.array(androidStepShape).min(1).describe('Ordered steps. Put a "caption" where the narration should change.'),
			serial: z.string().optional().describe('adb device serial (-s) when more than one is connected.'),
			bitRate: z.number().optional().describe('Recording bit rate. Default 8000000.'),
			size: z.string().optional().describe('Recording size "WxH". Default: device resolution.'),
			srt: z.string().optional().describe('Custom path for the .srt sidecar.'),
			burnIn: z.boolean().optional().describe('Burn captions into the video. Default true.'),
			adbPath: z.string().optional().describe('Path to adb (auto-detected from ANDROID_HOME / ~/Android/Sdk).'),
			tts: ttsShape.optional(),
			captionStyle: z.object({ fontSize: z.number().optional(), marginV: z.number().optional() }).optional(),
		},
	},
	async (args) => {
		try {
			const result = await recordAndroidTutorial(args);
			return { content: [ { type: 'text', text: `✅ Android tutorial recorded.\n${JSON.stringify(result, null, 2)}` } ] };
		} catch(err) {
			return { isError: true, content: [ { type: 'text', text: `❌ ${err.message}` } ] };
		}
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('screenwright MCP server running (stdio)');
