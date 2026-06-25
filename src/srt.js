// Shared SubRip (.srt) helpers — used by the web (Playwright) and Android (adb) drivers.

function pad(n, l = 2) { return String(n).padStart(l, '0'); }

export function tsms(ms) {
	const h = Math.floor(ms / 3600000);
	const m = Math.floor((ms % 3600000) / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	return `${pad(h)}:${pad(m)}:${pad(s)},${pad(Math.floor(ms % 1000), 3)}`;
}

/** @param {Array<{start:number,end:number,text:string}>} cues */
export function toSrt(cues) {
	return cues
		.map((c, i) => `${i + 1}\n${tsms(c.start)} --> ${tsms(Math.max(c.end, c.start + 1200))}\n${c.text}\n`)
		.join('\n');
}
