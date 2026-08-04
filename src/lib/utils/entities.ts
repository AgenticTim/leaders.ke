// HTML-entity decoding for text that leaks entities from scraped/ingested
// markup (news excerpts especially: RSS feeds double-encode, so one XML-level
// decode leaves literal `&nbsp;` / `&#039;` in the stored text). The `entities`
// package handles each pass (full named + numeric coverage); the loop runs
// until stable so double-encoded input (`&amp;#039;`) fully resolves. Shared by
// the news ingester, the display-side plainText pipeline, and the DB backfill
// script (scripts/clean-post-entities.ts).
import { decodeHTML } from 'entities';

export function decodeHtmlEntities(input: string): string {
	let out = input;
	// 3 passes cover any sane encoding depth; the loop exits early once stable.
	for (let i = 0; i < 3; i++) {
		const next = decodeHTML(out);
		if (next === out) break;
		out = next;
	}
	// Non-breaking spaces read as odd gaps in excerpts, normalize to plain.
	return out.replace(/ /g, ' ');
}
