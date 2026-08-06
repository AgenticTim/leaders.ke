// The publishing outlet behind an aggregated news mention, for the "read it
// there" link on the news feed.
//
// Two shapes, because ingestion has two paths (see $lib/server/newsIngest.ts):
//  - Google News search results carry an opaque news.google.com redirect URL, so
//    the host says nothing. Their titles instead end in " - <Publisher>", which
//    is where the name comes from (99% of ingested rows have one).
//  - Site feeds (The Standard, KBC…) link straight to the outlet, so the host
//    itself is the answer.

/** Publisher names are short and title-ish; anything longer is a headline that
 * merely happens to contain a dash. */
const MAX_PUBLISHER_LENGTH = 40;

/** The " - <Publisher>" suffix Google News appends to a headline, or null when
 * the title has no such suffix (or it doesn't look like a publisher name). */
export function publisherFromTitle(title: string): string | null {
	const at = title.lastIndexOf(' - ');
	if (at === -1) return null;
	const candidate = title.slice(at + 3).trim();
	if (!candidate || candidate.length > MAX_PUBLISHER_LENGTH) return null;
	// A trailing clause ("… - and here is why") reads as prose, not a masthead.
	if (candidate.split(/\s+/).length > 5) return null;
	return candidate;
}

/** A hostname as a readable outlet name: drops www./m. and the trailing TLD
 * segment kept only when it's part of how the outlet brands itself. Kenyan
 * outlets are widely known by their domain (standardmedia.co.ke), so the host
 * is left recognisable rather than prettified into a guess at their masthead. */
function hostLabel(host: string): string {
	return host.replace(/^(www|m|amp)\./, '');
}

/** The outlet to credit for a mention: its Google News title suffix, else its
 * link's host. Null when neither is available (the caller falls back to
 * generic wording). */
export function newsSourceName(sourceUrl: string | null, title: string): string | null {
	if (!sourceUrl) return null;
	let host = '';
	try {
		host = new URL(sourceUrl).hostname;
	} catch {
		return publisherFromTitle(title);
	}
	if (host === 'news.google.com') return publisherFromTitle(title);
	return hostLabel(host) || null;
}
