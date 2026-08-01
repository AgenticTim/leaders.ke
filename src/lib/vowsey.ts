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
	/** Mask everything typed into inputs in replays (default true). Opt out only
	 * when replays must show form contents and the forms hold nothing sensitive. */
	maskInputs?: boolean;
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

	// ── Pageviews: one row per viewed page, SPA navigations included. Each view
	// gets its own viewId; the entry beacon inserts the row and the exit beacon
	// (route change or pagehide) updates it with time-on-page — the server upserts
	// on (project, viewId), so a view never counts twice. ──
	let viewId = '';
	let viewPage = '';
	let enteredAt = 0;

	const sendView = (referrer: string | null, durationMs: number | null, beacon = false) =>
		post(
			`${host}/api/ingest`,
			{
				key,
				visitorId,
				sessionId,
				viewId,
				page: viewPage,
				referrer,
				screenRes: `${screen.width}x${screen.height}`,
				durationMs
			},
			beacon
		);

	const startView = () => {
		// In-app navigations inherit the previous page as referrer; the first view
		// uses the real document referrer.
		const referrer = viewPage || document.referrer || null;
		viewId = crypto.randomUUID();
		viewPage = location.href;
		enteredAt = Date.now();
		sendView(referrer, null);
	};
	const endView = (beacon = false) => sendView(null, Date.now() - enteredAt, beacon);

	// SPA route changes: history API patch + popstate. replaceState fires for
	// scroll/state bookkeeping in most frameworks, so only an actual URL change
	// closes the current view.
	const onRouteChange = () => {
		if (location.href === viewPage) return;
		endView();
		startView();
	};
	for (const m of ['pushState', 'replaceState'] as const) {
		const orig = history[m].bind(history);
		history[m] = (...args: Parameters<History['pushState']>) => {
			orig(...args);
			onRouteChange();
		};
	}
	window.addEventListener('popstate', onRouteChange);

	startView();
	window.addEventListener('pagehide', () => endView(true));

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
			record({ emit: (e) => buffer.push(e), maskAllInputs: opts.maskInputs !== false });
			flush(); // ship the initial snapshot immediately so short sessions still replay
			setInterval(() => flush(), FLUSH_MS);
			window.addEventListener('pagehide', () => flush(true));
		})
		.catch(() => {});
}
