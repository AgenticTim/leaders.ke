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

/** Outlets whose host or Google News suffix is a bare domain but whose real
 * masthead is well known. Keyed on the lowercased name minus its TLD. */
const OUTLET_NAMES: Record<string, string> = {
	standardmedia: 'The Standard',
	'the-star': 'The Star',
	nation: 'Daily Nation',
	peopledaily: 'People Daily',
	capitalfm: 'Capital FM',
	kbc: 'KBC',
	citizen: 'Citizen Digital',
	tuko: 'Tuko',
	allafrica: 'AllAfrica',
	bbc: 'BBC',
	dw: 'DW',
	thekenyandiaspora: 'The Kenyan Diaspora',
	businessdailyafrica: 'Business Daily'
};

// A real TLD list rather than "a dot and some letters": that shape also matches
// ordinary prose like "Mr.Kenyatta", and stripping there would mangle names.
// Kenyan second-level domains (.co.ke, .go.ke) come first so they match whole.
const TLD = String.raw`(?:(?:co|go|or|ac|ne|sc)\.)?(?:ke|ug|tz|rw|za|africa|com|net|org|info|news|digital|media|press|today|world|online|live|blog|site|link|app|dev|xyz|biz|tv|io|me|fm|uk|us|pl|de|fr|ca|au|in)`;

/** The domain suffix at the END of an outlet name, e.g. the ".pl" of "Gov.pl". */
const TLD_SUFFIX = new RegExp(String.raw`\.${TLD}$`, 'i');

/**
 * An outlet name safe to put in a WhatsApp message: WhatsApp auto-links
 * anything that looks like a domain, so "Gov.pl" would render as a tappable
 * (and misleading) link. Known outlets get their masthead; everything else
 * keeps its first label with the TLD dropped, so nothing but our own URL
 * survives as a link.
 */
export function readableOutlet(name: string | null): string | null {
	if (!name) return null;
	// Only the first label matters: "news-africa.churchofjesuschrist.org" is
	// News Africa, not a church domain.
	const firstLabel = name.split('.')[0];
	const bare = TLD_SUFFIX.test(name) ? firstLabel : name;
	const mapped = OUTLET_NAMES[bare.toLowerCase()];
	if (mapped) return mapped;
	// Hyphens are word breaks in a host ("the-star" is The Star). An all-lowercase
	// token gets title-cased; anything already carrying capitals keeps them, so
	// "MalindiKenya" and "DW" aren't mangled.
	const words = bare.split('-').filter(Boolean);
	return (
		words
			.map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
			.join(' ') || null
	);
}

/** Strips anything WhatsApp would auto-link out of free text (a headline, an AI
 * summary): full URLs go entirely, and a bare domain keeps only its name. Our
 * own link is added separately by the brief, so it never passes through here. */
export function stripLinks(text: string): string {
	return text
		.replace(/https?:\/\/\S+/gi, '')
		.replace(/\bwww\.\S+/gi, '')
		.replace(new RegExp(String.raw`\b([a-z0-9][a-z0-9-]*)\.${TLD}\b`, 'gi'), '$1')
		.replace(/\s{2,}/g, ' ')
		.trim();
}
