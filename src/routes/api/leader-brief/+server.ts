// The WhatsApp brief for one leader, fetched when someone taps a copy button on
// the news page (see CopyBriefButton.svelte). Public and free: this is a
// distribution feature the platform pays for, not the leader's paid
// knowledgebase, so no wallet gate here.
import { json } from '@sveltejs/kit';
import { getLeaderBrief } from '$lib/server/leaderBrief';
import { enforceRateLimit, ipBucket } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const slug = (event.url.searchParams.get('slug') ?? '').replace(/^\//, '').trim();
	if (!slug) return json({ error: 'Missing slug.' }, { status: 400 });

	// A cache miss can trigger a Haiku call, so an unauthenticated caller must not
	// be able to walk the register and force a generation for every leader.
	const limit = await enforceRateLimit('brief', [ipBucket(event)]);
	if (!limit.ok) {
		return json({ error: 'Too many briefs, give it a moment.' }, { status: 429 });
	}

	const brief = await getLeaderBrief(slug, event.url.origin);
	if (!brief) return json({ error: 'No recent news for this leader.' }, { status: 404 });
	return json(brief);
};
