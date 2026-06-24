#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { recordTutorial } from './recorder.js';

const server = new McpServer({ name: 'screenwright', version: '0.1.0' });

const stepShape = z.object({
	caption: z.string().optional().describe('Subtitle to show during this step (stays until the next caption). Burned into the video + written to the .srt.'),
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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('screenwright MCP server running (stdio)');
