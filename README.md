# 🎬 Screenwright

> **Subtitled tutorial videos, scripted.** An [MCP](https://modelcontextprotocol.io) server that turns a list of steps into a narrated screen recording — by driving a real **browser** ([Playwright](https://playwright.dev)) *or* an **Android / Flutter emulator** (`adb`). Captions are **burned into the video** *and* exported as an `.srt`.

The name is a play on **Playwright** (the engine under the hood) + *screen*.

```
steps[]  ──►  Playwright drives the browser  ──►  caption overlay synced per step
         ──►  video recorded  ──►  ffmpeg → .mp4  +  .srt sidecar
```

---

## ✨ Features

- **Scripted walkthroughs** — `goto`, `click`, `fill`, `type`, `press`, `hover`, `scroll`, `wait`.
- **Synced subtitles** — attach a `caption` to any step; it's burned into the video and written to a timed `.srt`.
- **Self-contained output** — bundled `ffmpeg` (via `ffmpeg-static`) produces a clean H.264 `.mp4`.
- **Robust** — per-action timeouts; mark a step `optional` so a missing selector doesn't abort the take.
- **Web *and* mobile** — Playwright for the web; `adb` screen-record + ffmpeg caption-burn for **Android / Flutter** apps (no app source needed).
- **Use it from an AI** (MCP tool) **or** straight from Node.

## 📦 Requirements

- Node.js **18+**
- A Chromium build for Playwright: `npx playwright install chromium` (run automatically on `npm install`).

## 🚀 Install

```bash
# from GitHub
npm install -g github:0xjesus/screenwright

# or clone
git clone https://github.com/0xjesus/screenwright.git
cd screenwright && npm install
```

## 🔌 Use as an MCP server

Add it to your MCP client. **Claude Desktop / Claude Code** (`claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "screenwright": {
      "command": "node",
      "args": ["/absolute/path/to/screenwright/src/index.js"]
    }
  }
}
```

(If installed globally, you can use `"command": "screenwright"` with no args.)

Then just ask your assistant to record a tutorial — it calls the **`record_tutorial`** tool.

### Tool: `record_tutorial`

| Field | Type | Notes |
|---|---|---|
| `output` | string | Path to the output `.mp4`. |
| `steps` | step[] | Ordered steps (below). |
| `baseUrl` | string? | So `goto` steps can use relative paths. |
| `viewport` | `{width,height}`? | Default `1440×900`. |
| `headless` | bool? | Default `true`. |
| `channel` | string? | e.g. `"chrome"` to use the system browser. |
| `burnIn` | bool? | Burn captions into the video. Default `true`. |
| `srt` | string? | Custom `.srt` path. Default `<output>.captions.srt`. |
| `captionStyle` | object? | `{ position, fontSize, bg, color, maxWidth }`. |

**Step** = `{ caption?, action, url?, selector?, text?, key?, deltaY?, delayMs?, timeoutMs?, dwellMs?, optional? }`.
`selector` is any Playwright selector — CSS, `text=…`, `xpath=…`, or `:has-text(…)`.

### Tool: `record_android_tutorial` 📱

Same idea, for a **Flutter / Android app on an emulator or device**. Captions can't be injected into a native app, so the screen is recorded with `adb screenrecord` and the captions are **burned in afterwards** with ffmpeg (libass) from the synced `.srt`.

**Requires:** Android platform-tools (`adb`) + a **running emulator/device** (it must show in `adb devices`). For Flutter: `flutter emulators --launch <id>`, then run your app.

| Field | Notes |
|---|---|
| `output` | Output `.mp4`. |
| `steps` | Ordered steps (below). |
| `serial` | `adb -s` serial when several devices are connected. |
| `size` | Recording size `"WxH"` (default: device resolution). |
| `bitRate` · `srt` · `burnIn` · `adbPath` · `captionStyle` | Optional. |

**Step actions** (coordinates are **device pixels**) — each may carry a `caption` and `dwellMs`:

- `tap` — `{ x, y }`
- `text` — `{ text }`
- `swipe` — `{ x1, y1, x2, y2, durationMs? }`
- `key` — `{ key }` (`BACK`, `HOME`, `ENTER`, `MENU`, `APP_SWITCH`, or a `KEYCODE_*`)
- `launch` — `{ package, activity? }`
- `wait` — `{ dwellMs }`

See **`examples/android-flutter.json`**. From Node: `import { recordAndroidTutorial } from 'screenwright/android'`.

## 🧪 Use from Node (no MCP)

```bash
node scripts/run-example.js                 # records examples/demo.json
node scripts/run-example.js examples/capleton.json
```

```js
import { recordTutorial } from 'screenwright/recorder';

await recordTutorial({
  output: 'out/tour.mp4',
  baseUrl: 'https://playwright.dev',
  steps: [
    { action: 'goto', url: '/', caption: 'Welcome to the tour 🎬', dwellMs: 2600 },
    { action: 'scroll', deltaY: 600, caption: 'Each step can carry a synced subtitle…', dwellMs: 2400 },
    { action: 'goto', url: '/docs/intro', caption: '…burned into the video and exported as .srt', dwellMs: 3000 },
  ],
});
// → { mp4, srt, durationMs, steps, captions }
```

## 💡 Tips

- **Don't double your subtitles.** The `.mp4` already has burned-in captions. Players like VLC *auto-load* an `.srt` that shares the video's name and draw it **on top**. Screenwright defaults the sidecar to `*.captions.srt` (a non-matching name) so that doesn't happen — keep it that way, or disable the subtitle track in your player. Want selectable-only subs? Pass `burnIn: false` for a clean video + the `.srt`.
- **Black video in VLC on Linux?** That's a GPU/output glitch, not the file. Launch with `vlc --avcodec-hw=none --vout=xcb_x11`, or set those in VLC → Preferences.
- **Headless still records** — no display needed.

## 📝 License

MIT © 0xjesus
