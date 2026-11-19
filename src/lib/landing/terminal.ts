// The session shown in the landing page's terminal, under The machine surface (#connect).
//
// It is an ILLUSTRATION, not a live call - a real tool call on page load would put
// an Aurora query behind every crawler hit on the site's root. The figures are the
// genuine top of the app_stack_count leaderboard as at 2026-08-15, typed in by hand;
// refresh them by hand, from the tool. (The board's figures above it are live, read on
// the landing cache's own clock - $lib/server/landing - since 2026-10-15.)
//
// Split into typed steps so the animation can pace a typed prompt differently from
// a streamed response. Each `s` is an HTML fragment, rendered with {@html} - the
// strings are authored here and the only interpolated value is the endpoint, which
// is escaped below. Nothing user-supplied ever reaches this.
//
// The whole transcript is rendered server-side and the animation REPLACES it, so a
// reader without JavaScript - or a crawler, or an agent fetching the HTML - sees the
// finished session rather than an empty box.

export type StepKind = 'cmd' | 'out' | 'gap' | 'ask' | 'call' | 'env' | 'row' | 'note';

export interface Step {
	t: StepKind;
	s: string;
}

function esc(v: string): string {
	return v
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function transcript(endpoint: string): Step[] {
	const e = esc(endpoint);
	return [
		{ t: 'cmd', s: `<span class="u">$</span> claude mcp add --transport http nostrology ${e}` },
		{
			t: 'out',
			s: '<span class="g">Added</span> nostrology <span class="d">- 3 tools (1 paid), 1 resource, no auth</span>'
		},
		{ t: 'gap', s: '' },
		{
			t: 'ask',
			s: '<span class="u">&gt;</span> Which apps do Nostr users actually put in their public app stacks?'
		},
		{ t: 'gap', s: '' },
		{
			t: 'call',
			s: '<span class="d">tool</span> <span class="k">nostrology_query_metric</span> <span class="d">{</span> metric: <span class="p">"app_stack_count"</span> <span class="d">}</span>'
		},
		{ t: 'gap', s: '' },
		{
			t: 'env',
			s: '<span class="d">metric:</span> zapstore.app_stack_count <span class="d">|</span> <span class="d">grain:</span> current <span class="d">|</span> <span class="d">unit:</span> stacks'
		},
		{
			t: 'env',
			s: '<span class="d">state:</span> current snapshot, no time axis - never summed across calls'
		},
		{
			t: 'env',
			s: '<span class="d">methodology:</span> distinct kind-30267 (zapstore-app-stacks) lists referencing each app.'
		},
		{ t: 'gap', s: '' },
		// The five table lines are each padded to the same width so the counts stay
		// right-aligned; edit them as a set, never one at a time.
		{ t: 'row', s: 'app_name              stack_count' },
		{ t: 'row', s: '<span class="k">Amber</span>                          57' },
		{ t: 'row', s: '<span class="k">Amethyst</span>                       46' },
		{ t: 'row', s: '<span class="k">Zapstore</span>                       32' },
		{ t: 'row', s: '<span class="k">bitchat</span>                        25' },
		{ t: 'gap', s: '' },
		{
			t: 'note',
			s: '<span class="g">answer</span> <span class="d">a snapshot, so the agent knows not to trend it.</span>'
		}
	];
}

/** The transcript as one HTML block - what SSR renders and what the animation
 *  converges back to. */
export function transcriptHtml(endpoint: string): string {
	return transcript(endpoint)
		.map((x) => x.s)
		.join('\n');
}
