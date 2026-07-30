// Vowsey browser SDK, vendored from the Vowsey repo (packages/client/src/index.ts,
// @vowsey/client 0.1.0) because the package is not published to npm. Framework-agnostic:
// call init() once with the project's public write key and the Vowsey host. Owns
// visitor/session identity client-side (cross-origin: the SaaS can't set a
// first-party cookie on this domain).

export type InitOptions = {
	/** Public project write key (rt_...), from the project's Settings → Install. */
	key: string;
	/** Vowsey host origin, e.g. https://app.vowsey.com */
	host: string;
	/** Record rrweb session replays (default true). Pageviews are always sent. */
	recordReplay?: boolean;
};

const VISITOR_KEY = 'rt_vid';
const SESSION_KEY = 'rt_sid';
const FLUSH_MS = 5000;

function persistentId(store: Storage, k: string): string {
	try {
		let v = store.getItem(k);
		if (!v) {
			v = crypto.randomUUID();
			store.setItem(k, v);
		}
		return v;
	} catch {
		return crypto.randomUUID();
	}
}

function post(url: string, payload: object, beacon = false): void {
	const body = JSON.stringify(payload);
	if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
		navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
	} else {
		fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => {});
	}
}

let started = false;

/** Initialise capture. Safe to call once; no-ops on the server or on repeat calls. */
export function init(opts: InitOptions): void {
	if (typeof window === 'undefined' || started) return;
	started = true;

	const host = opts.host.replace(/\/$/, '');
	const key = opts.key;
	const visitorId = persistentId(localStorage, VISITOR_KEY);
	const sessionId = persistentId(sessionStorage, SESSION_KEY);

	// ── Pageview: send once now, and again on exit with time-on-page. Both beacons
	// share one viewId so the server upserts a single row per view. ──
	const enteredAt = Date.now();
	const viewId = crypto.randomUUID();
	const sendView = (durationMs: number | null, beacon = false) =>
		post(
			`${host}/api/ingest`,
			{
				key,
				visitorId,
				sessionId,
				viewId,
				page: location.href,
				referrer: document.referrer || null,
				screenRes: `${screen.width}x${screen.height}`,
				durationMs
			},
			beacon
		);
	sendView(null);
	window.addEventListener('pagehide', () => sendView(Date.now() - enteredAt, true));

	// ── Session replay (rrweb, dynamically imported so it never blocks page load) ──
	if (opts.recordReplay === false) return;
	let buffer: unknown[] = [];
	let seq = 0;
	const flush = (beacon = false) => {
		if (buffer.length === 0) return;
		const events = buffer;
		buffer = [];
		post(`${host}/api/ingest/replay`, { key, visitorId, sessionId, seq: seq++, events }, beacon);
	};

	import('rrweb')
		.then(({ record }) => {
			record({ emit: (e) => buffer.push(e), maskAllInputs: false });
			flush(); // ship the initial snapshot immediately so short sessions still replay
			setInterval(() => flush(), FLUSH_MS);
			window.addEventListener('pagehide', () => flush(true));
		})
		.catch(() => {});
}
