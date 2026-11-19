<script lang="ts">
	import { onMount } from 'svelte';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import { HARNESSES, stdioShim } from '$lib/mcp/harnesses';
	import { transcript, transcriptHtml } from '$lib/landing/terminal';
	import LandingBoard from '$lib/components/landing/LandingBoard.svelte';
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import { jsonLdScript, webSiteJsonLd } from '$lib/seo/jsonLd';

	export let data: PageData;

	$: endpoint = data.endpoint;
	$: terminal = transcriptHtml(endpoint);
	// The SAME steps the markup renders, kept as structured data so the animation
	// can pace them off `t` instead of re-deriving it from serialized HTML.
	$: steps = transcript(endpoint);

	// Which harness panel is showing. Every panel is rendered and merely `hidden`,
	// so all thirteen snippets are in the served HTML whether or not anything runs
	// scripts - the same contract /data holds, and for the same readers.
	let openHarness = HARNESSES[0].id;

	let root: HTMLElement;
	let copied: string | null = null;

	async function copy(text: string, key: string) {
		try {
			await navigator.clipboard?.writeText(text);
		} catch {
			// A clipboard rejection (permissions, insecure context) is not worth an
			// error state on a landing page; the URL is selectable either way.
			return;
		}
		copied = key;
		setTimeout(() => {
			if (copied === key) copied = null;
		}, 1400);
	}

	// Smooth scrolling for the MCP bar's "Connect" anchor (#connect). Applied
	// imperatively rather than as a `:global(html)` CSS rule: component CSS is never
	// unloaded once fetched, so a global rule survives client-side navigation away
	// and hands smooth scrolling to EVERY other route for the rest of the session -
	// including SvelteKit's own scrollTo(0,0) on navigation and back/forward scroll
	// restoration, which then animate instead of jumping.
	onMount(() => {
		const html = document.documentElement;
		const previous = html.style.scrollBehavior;
		html.style.scrollBehavior = 'smooth';
		return () => {
			html.style.scrollBehavior = previous;
		};
	});

	onMount(() => {
		// The pre-paint gate armed a watchdog (see <svelte:head>) that un-hides
		// everything if this code never arrives. It arrived; disarm it.
		clearTimeout((window as any).__landingRevealWatchdog);

		// `has-gsap` is set by the gate script in <svelte:head>, BEFORE first paint,
		// which is what makes hiding the reveal targets safe (see the CSS note on
		// `.rv`). If the library is absent - a client-side arrival in a tab that has not
		// loaded it yet, a failed asset, scripts disabled - nothing here runs and the
		// server-rendered page simply stands as it is.
		const gsap = (window as any).gsap;
		const ScrollTrigger = (window as any).ScrollTrigger;
		if (!gsap || !ScrollTrigger) return;

		// Checked AFTER the library, and optionally: jsdom has no matchMedia, and a
		// test rendering this component must not have to stub one to get past a line
		// that only matters when there is an animation to suppress.
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

		// The one hole the inverted gate does not cover by itself: `has-gsap` is already
		// stamped, so the reveal targets are ALREADY at opacity 0, and anything that
		// throws between here and the last gsap.to() leaves them that way - a blank page
		// with content that is present but invisible, the exact failure the gate exists
		// to prevent. Dropping the class restores every one of them in the same frame.
		try {
			setUpAnimation(gsap, ScrollTrigger);
		} catch (err) {
			document.documentElement.classList.remove('has-gsap');
			console.error('[landing] animation setup failed; showing the static page', err);
			return;
		}

		return () => {
			// The typing chain steps through gsap.delayedCall and a setInterval; without
			// this it keeps running against a detached <pre> after a navigation away,
			// holding the GSAP ticker alive for the rest of the transcript.
			typingCancelled = true;
			clearInterval(typer);
			ScrollTrigger.getAll().forEach((t: { kill: () => void }) => t.kill());
		};
	});

	let typingCancelled = false;
	let typer: ReturnType<typeof setInterval> | undefined;

	function setUpAnimation(gsap: any, ScrollTrigger: any) {
		const q = (sel: string) => Array.from(root.querySelectorAll(sel));

		// Headline word-split, so each word can be staggered - done here rather than in
		// the markup to keep the heading readable and copy-editable (SplitText is a
		// club plugin). Walks CHILD NODES rather than rewriting innerHTML with a regex:
		// Svelte stamps its scope class onto the <em>, so a pattern matching a bare
		// `<em>` silently fails and dumps the raw tag into the rendered heading.
		const hl = root.querySelector('#hl') as HTMLElement | null;
		if (hl) {
			const split = document.createDocumentFragment();
			const wrap = (child: Node) => {
				const span = document.createElement('span');
				span.className = 'w';
				span.appendChild(child);
				split.appendChild(span);
				split.appendChild(document.createTextNode(' '));
			};
			Array.from(hl.childNodes).forEach((node) => {
				if (node.nodeType !== Node.TEXT_NODE) {
					// An inline element (the <em>) staggers as one unit.
					wrap(node);
					return;
				}
				(node.textContent ?? '')
					.split(/\s+/)
					.filter(Boolean)
					.forEach((word) => wrap(document.createTextNode(word)));
			});
			hl.replaceChildren(split);
		}

		gsap.registerPlugin(ScrollTrigger);

		// Every target is resolved against `root` rather than passed as a selector
		// string: GSAP would otherwise query the whole document, which is wrong the
		// moment anything else on the page grows a `.rv` or a `.beam`.
		const kicker = root.querySelector('.kicker');
		const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
		tl.from(kicker, { opacity: 0, y: 12, duration: 0.5 })
			.to(kicker, { opacity: 1, duration: 0 }, 0)
			.from(q('#hl .w'), { opacity: 0, y: 26, rotateX: -40, duration: 0.62, stagger: 0.045 }, '-=.2')
			.to(q('.hero .rv'), { opacity: 1, y: 0, duration: 0.6, stagger: 0.12, startAt: { y: 18 } }, '-=.35');

		// The typing pass REPLAYS a transcript that is already on the page: SSR put the
		// finished session in the <pre>, so this rewinds it to empty and types it back.
		// A reader who never runs scripts keeps the finished version. Since the board took
		// the hero (2026-10-15) the terminal sits in The machine surface, and types once it
		// is scrolled to, held at its finished height so nothing below it moves.
		//
		// It drives off `steps` - the SAME Step[] the markup was rendered from - rather
		// than re-parsing the <pre>'s innerHTML. Reading it back is not equivalent:
		// Svelte's {@html} leaves an anchor comment, so the first line arrives as
		// `<!---->` + the command and any pattern anchored at the prompt glyph misses
		// it, silently dumping the `claude mcp add` line instead of typing it. The
		// step's own `t` discriminant is authoritative and cannot drift.
		const out = root.querySelector('#out') as HTMLElement | null;
		if (out && steps.length) {
			out.style.minHeight = `${out.offsetHeight + parseFloat(getComputedStyle(out).lineHeight)}px`;
			const caret = '<span class="caret"></span>';
			const upTo = (n: number) =>
				steps
					.slice(0, n)
					.map((x) => x.s)
					.join('\n');
			let i = 0;
			const step = () => {
				if (typingCancelled) return;
				if (i >= steps.length) {
					out.innerHTML = upTo(steps.length) + '\n<span class="u">&gt;</span> ' + caret;
					return;
				}
				const done = upTo(i);
				const cur = steps[i];
				if (cur.t === 'cmd' || cur.t === 'ask') {
					// Strip the tags to get the typeable text, then drop the prompt glyph -
					// which is `&gt;` in the source, NOT `>`, since these strings are HTML.
					const plain = cur.s.replace(/<[^>]+>/g, '');
					const prompt = cur.s.slice(0, cur.s.indexOf('</span>') + 7);
					const body = plain.replace(/^(?:\$|&gt;|>)\s*/, '');
					let n = 0;
					typer = setInterval(() => {
						if (typingCancelled) return clearInterval(typer);
						n++;
						out.innerHTML = (done ? done + '\n' : '') + prompt + ' ' + body.slice(0, n) + caret;
						out.scrollTop = out.scrollHeight;
						if (n >= body.length) {
							clearInterval(typer);
							i++;
							gsap.delayedCall(0.45, step);
						}
					}, 22);
				} else {
					out.innerHTML = upTo(i + 1) + '\n' + caret;
					out.scrollTop = out.scrollHeight;
					const pace = cur.t === 'gap' ? 0.08 : cur.t === 'call' ? 0.5 : 0.17;
					i++;
					gsap.delayedCall(pace, step);
				}
			};
			ScrollTrigger.create({
				trigger: out,
				start: 'top 85%',
				once: true,
				onEnter: () => {
					out.innerHTML = '';
					gsap.delayedCall(0.3, step);
				}
			});
		}

		q('section .rv').forEach((el) => {
			gsap.to(el, {
				opacity: 1,
				y: 0,
				duration: 0.65,
				ease: 'power2.out',
				startAt: { y: 22 },
				scrollTrigger: { trigger: el, start: 'top 92%' }
			});
		});

		// The counters count UP to the value already rendered, so the final state is
		// whatever SSR wrote - the animation can never leave a wrong number on screen. The
		// board's figure has its unit and its button beside it, so it holds its finished
		// width while it counts; a resize changes the type size, so it lets go then.
		q('.num').forEach((el) => {
			const w = (el as HTMLElement).getBoundingClientRect().width;
			if (w) {
				(el as HTMLElement).style.minWidth = `${Math.ceil(w)}px`;
				window.addEventListener('resize', () => ((el as HTMLElement).style.minWidth = ''), { once: true });
			}
			const target = Number((el as HTMLElement).dataset.to);
			const o = { v: 0 };
			gsap.to(o, {
				v: target,
				duration: 1.6,
				ease: 'power2.out',
				scrollTrigger: { trigger: el, start: 'top 90%' },
				onUpdate: () => {
					// 'en-US' explicitly, matching the SSR'd value: the default locale is the
					// BROWSER's, so a de-DE visitor would watch the counter animate up and
					// land on 34.610, overwriting the 34,610 the server rendered.
					el.textContent = Math.round(o.v).toLocaleString('en-US');
				}
			});
		});

		// The pipeline reads left to right, so the beams fill in sequence as it scrolls in.
		ScrollTrigger.create({
			trigger: root.querySelector('.pipe'),
			start: 'top 80%',
			once: true,
			onEnter: () => {
				gsap.to(q('.beam'), { width: '100%', duration: 0.5, stagger: 0.18, ease: 'power1.inOut' });
			}
		});

	}

	// This page's own origin, from the request - NOT from the endpoint URL. Those are
	// separate settings, and deriving one from the other means a PUBLIC_MCP_ENDPOINT
	// pointed at another host silently relocates every canonical, og:url and og:image
	// to a host that does not serve this page.
	$: origin = data.origin;
	// The site-name record for search results; home page only. See $lib/seo/jsonLd.
	$: webSiteRecord = jsonLdScript(webSiteJsonLd(origin));
</script>

<!-- The headline and the line under it, word for word as picked on 2026-10-15. -->
<SocialMeta
	title="Nostrology - Nostr growth, in numbers"
	socialTitle="Nostr growth, in numbers"
	description="Prominent domains of the Nostr ecosystem, observed from the raw events: in charts and stats for you, and an MCP endpoint for your agent. One daily-fresh archive serving both."
	socialDescription="Prominent domains of the Nostr ecosystem, observed from the raw events: in charts and stats for you, and an MCP endpoint for your agent."
	canonicalPath="/"
	{origin}
/>

<svelte:head>
	<!-- GSAP, from our own origin: scripts/vendor-gsap.mjs copies these two files from
	     the gsap package that package.json pins, at every `pnpm dev` and `pnpm build`, and
	     scripts/vendor-gsap.test.mjs holds these paths to that version. Not a CDN link,
	     which would put a third-party origin on the root page's critical path and have
	     every visitor's browser contact it, and not an npm import, which would run only
	     after first paint. These MUST stay blocking tags in <head>: the gate script below
	     stamps `has-gsap` before first paint, and the CSS hides the reveal targets only
	     when that class is present.
	     Reverse the order and the hero paints, blanks, and fades back in. -->
	<script src="/vendor/gsap-3.12.5/gsap.min.js"></script>
	<script src="/vendor/gsap-3.12.5/ScrollTrigger.min.js"></script>
	<!-- Stamps `has-gsap` (which is what hides the reveal targets - see the `.rv` note
	     in <style>) and arms a watchdog that un-hides them if hydration never arrives.
	     A file rather than an inline script: Svelte's preprocessor feeds the contents
	     of a script tag inside svelte:head to PostCSS. Full rationale in the file. -->
	<script src="/scripts/landing-gate.js"></script>
	<!-- WebSite structured data (name "Nostrology", alternateName "nostrolo.gy"): the input
	     Google weighs first for the site name shown in results. Built and escaped in
	     $lib/seo/jsonLd; the social cards keep og:site_name = nostrolo.gy on purpose. -->
	{@html webSiteRecord}
</svelte:head>

<div class="landing" bind:this={root}>
	<SiteNav ssrSession={data.session ?? null} />

	<!-- ============ HERO ============ -->
	<!-- The board (the operator's pick of 2026-10-15): the
	     headline, then one surface's chart at a time with its figure, the roster of every
	     surface, and the MCP bar - both pillars, charts and MCP, above the fold. -->
	<header class="hero">
		<div class="wrap top">
			<div class="kicker rv">
				<span class="kicker-a">Nostr ecosystem observatory</span>
				<span class="ln"></span>
				<span class="kicker-b">methodology included</span>
				<span class="fresh"><i aria-hidden="true"></i>Updated daily</span>
			</div>
			<h1 id="hl">Nostr growth, <em>in&nbsp;numbers.</em></h1>
			<p class="sub rv">
				Prominent domains of the Nostr ecosystem, observed from the raw events: in charts and stats
				for you, and an <b>MCP endpoint</b> for your agent. One daily-fresh archive serving both.
			</p>
		</div>
		<LandingBoard board={data.board}>
			<div class="mcpbar" data-fold="mcp">
				<span class="mb-k"
					><span class="mark-prompt" aria-hidden="true">&gt;_</span><span
						><b>MCP</b><small>for your agent</small></span
					></span
				>
				<div class="endpoint">
					<code>{endpoint}</code>
					<button type="button" on:click={() => copy(endpoint, 'hero')}>
						{copied === 'hero' ? 'Copied' : 'Copy'}
					</button>
				</div>
				<span class="mb-facts">Metrics and records as tools your agent calls. No&nbsp;account, no API key.</span>
				<a class="mb-go" href="#connect">Connect &rarr;</a>
			</div>
		</LandingBoard>
	</header>

	<!-- ============ PIPELINE ============ -->
	<section id="how">
		<div class="wrap">
			<div class="sec-num rv"><span class="n">01</span> Where it comes from</div>
			<h2 class="rv">Computed ground up from Nostr events, not from somebody's summary.</h2>
			<p class="lead rv">
				Every figure traces back to Nostr events we read off the relays ourselves - no third-party
				index in the chain, and no number without the rule that produced it.
			</p>
			<div class="pipe">
				<div class="step rv">
					<div class="i mono">01 acquire</div>
					<h4>Straight off the relays</h4>
					<p>Continuous raw Nostr event acquisition across public relays.</p>
					<span class="beam"></span>
				</div>
				<div class="step rv">
					<div class="i mono">02 archive</div>
					<h4>Scalable engine</h4>
					<p>Data engine that scales with the growth of the Nostr network itself.</p>
					<span class="beam"></span>
				</div>
				<div class="step rv">
					<div class="i mono">03 derive</div>
					<h4>Documented methodology</h4>
					<p>Each metric states its population, its partition, and what it deliberately excludes.</p>
					<span class="beam"></span>
				</div>
				<div class="step rv">
					<div class="i mono">04 serve</div>
					<h4>Charts and MCP, one source</h4>
					<p>Same underlying data powering MCP and the charts, so they cannot disagree.</p>
					<span class="beam"></span>
				</div>
			</div>
		</div>
	</section>

	<!-- ============ CONNECT ============ -->
	<section id="connect">
		<div class="wrap">
			<div class="sec-num rv"><span class="n">02</span> The machine surface</div>
			<h2 class="rv">Point an agent at it.<br />One line in whatever harness you already use.</h2>
			<p class="lead rv">
				Same archive, any angle: slice, dice and compare the numbers however your question&nbsp;needs.
			</p>
			<div class="term conn-term rv">
				<div class="term-bar">
					<i></i><i></i><i></i>
					<span class="t mono">nostrology &middot; streamable http</span>
					<span class="tag mono">nostrology-mcp</span>
				</div>
				<!-- {@html} is safe here: the fragment is authored in
				     $lib/landing/terminal.ts and the only interpolated value is the
				     endpoint, escaped there. Nothing user-supplied reaches it. -->
				<pre id="out">{@html terminal}</pre>
			</div>
			<!-- Iterated from $lib/mcp/harnesses.ts, which /data renders too. Restating the
			     snippets here instead would drift from /data - on a page that claims one
			     section earlier that its surfaces cannot disagree. -->
			<div class="h-tabs rv" role="tablist" aria-label="Harness registration instructions">
				{#each HARNESSES as h (h.id)}
					<button
						type="button"
						role="tab"
						class="h-tab"
						aria-selected={openHarness === h.id}
						aria-controls="hp-{h.id}"
						on:click={() => (openHarness = h.id)}
					>
						{h.name}
					</button>
				{/each}
			</div>
			<div class="rv">
				{#each HARNESSES as h (h.id)}
					<div
						class="h-panel"
						id="hp-{h.id}"
						data-h={h.id}
						role="tabpanel"
						aria-label="{h.name} registration"
						hidden={openHarness !== h.id}
					>
						{#if h.configPath}
							<p class="h-path">Edit <code>{h.configPath}</code></p>
						{/if}
						<div class="h-code">
							<pre><code>{h.snippet(endpoint)}</code></pre>
							<button type="button" class="h-copy" on:click={() => copy(h.snippet(endpoint), h.id)}>
								{copied === h.id ? 'Copied' : 'Copy'}
							</button>
						</div>
						{#if h.note}
							<p class="h-note">{h.note}</p>
						{/if}
					</div>
				{/each}
				<p class="h-more">Streamable HTTP, so native remote-MCP clients take the URL directly.</p>
				<details class="h-more">
					<summary>Harness has no remote-MCP support?</summary>
					<p class="h-note">Bridge the endpoint into a local stdio server with mcp-remote:</p>
					<div class="h-code">
						<pre><code>{stdioShim(endpoint)}</code></pre>
						<button type="button" class="h-copy" on:click={() => copy(stdioShim(endpoint), 'shim')}>
							{copied === 'shim' ? 'Copied' : 'Copy'}
						</button>
					</div>
				</details>
			</div>
		</div>
	</section>

	<SiteFooter ssrSession={data.session ?? null} />
</div>

<style>
	/* The landing page's own stylesheet. Svelte scopes all of it to this
	   component, which is what keeps bare `h1` / `section` / `footer` selectors from
	   reaching any other route - the reason this is not a plain imported .css file.
	   The palette below is the site's own: gray-900 canvas, gray-800 cards, gray-700
	   borders, teal-400 accent, and the Chart.js series colours for the five domains. */
	.landing {
		--bg: #111827;
		--bg-2: #1a2332;
		--panel: #1f2937;
		--line: #374151;
		--line-2: #2a3444;
		--text: #f3f4f6;
		--muted: #9ca3af;
		--dim: #6b7280;

		--teal: #2dd4bf;
		--teal-2: #5eead4;
		--purple: #9b59b6;
		--gold: #f39c12;
		--blue: #3498db;
		--green: #1abc9c;
		/* Git-on-Nostr's accent on the board and its roster, from the same flat palette as the
		   four above. */
		--red: #e74c3c;

		--maxw: 1120px;

		background: var(--bg);
		color: var(--text);
		line-height: 1.6;
	}
	/* No `:global(html) { scroll-behavior }` here on purpose - component CSS is never
	   unloaded, so a global rule would follow the visitor onto every other route for
	   the rest of the session. It is set and unset in onMount instead. */
	.landing a {
		color: inherit;
		text-decoration: none;
	}
	.mono,
	code,
	pre {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	}
	.wrap {
		width: 100%;
		max-width: var(--maxw);
		margin: 0 auto;
		padding: 0 22px;
	}

	/* ---------- hero: the headline, then the board (LandingBoard) ---------- */
	.hero {
		padding: 0 0 36px;
	}
	.top {
		padding-top: 22px;
		padding-bottom: 18px;
	}
	.kicker {
		font-size: 11.5px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--dim);
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 14px;
		flex-wrap: wrap;
	}
	/* The rule between the two kicker halves only earns its space once they fit on
	   one line; below that it would sit alone on a wrapped row. Below the same
	   breakpoint, "methodology included" is forced onto its own line and
	   right-aligned, so it reads as the second beat of a two-part line rather
	   than running together with the first phrase. The tighter gap/margin above
	   are mobile-only, restored to the original desktop values below. */
	.kicker .ln {
		display: none;
	}
	.kicker-b {
		flex-basis: 100%;
		text-align: right;
	}
	@media (min-width: 620px) {
		.kicker {
			gap: 10px;
			margin-bottom: 22px;
		}
		.kicker .ln {
			display: block;
			flex: 1 1 auto;
			height: 1px;
			background: var(--line);
			max-width: 180px;
		}
		.kicker-b {
			flex-basis: auto;
			text-align: left;
		}
	}
	h1 {
		margin: 0 0 8px;
		font-size: clamp(34px, 5vw, 56px);
		line-height: 1.02;
		letter-spacing: -0.035em;
		font-weight: 650;
	}
	h1 em {
		font-style: normal;
		color: var(--teal);
	}
	/* The kicker is one row with "Updated daily" at its end; under 620 px, the live site's
	   two lines, the second shared with "Updated daily". */
	.top .kicker {
		line-height: 1.5;
		margin: 0 0 14px;
	}
	.fresh {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		margin: 0 0 0 auto;
		color: var(--muted);
	}
	.fresh i {
		position: relative;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--teal);
	}
	@media (prefers-reduced-motion: no-preference) {
		.fresh i::after {
			content: '';
			position: absolute;
			inset: -4px;
			border-radius: 50%;
			border: 1px solid var(--teal);
			opacity: 0;
			animation: fresh 2.4s ease-out infinite;
		}
	}
	@keyframes fresh {
		0% {
			transform: scale(0.5);
			opacity: 0.8;
		}
		100% {
			transform: scale(1.6);
			opacity: 0;
		}
	}
	@media (max-width: 619px) {
		.top .kicker .kicker-a {
			flex-basis: 100%;
		}
		.top .kicker .kicker-b {
			flex-basis: auto;
			text-align: left;
		}
	}
	@media (max-width: 380px) {
		.top .kicker {
			font-size: 10.5px;
			letter-spacing: 0.16em;
		}
	}
	/* A laptop's short viewport (about 690 px tall): everything down to the MCP bar still
	   above the fold. */
	@media (min-width: 1000px) and (max-height: 760px) {
		.top {
			padding-top: 16px;
			padding-bottom: 14px;
		}
		.top .kicker {
			margin-bottom: 10px;
		}
		h1 {
			font-size: 50px;
		}
	}
	.landing :global(#hl .w) {
		display: inline-block;
	}
	.sub {
		margin: 0;
		font-size: clamp(15px, 1.7vw, 17.5px);
		line-height: 1.5;
		color: var(--muted);
		max-width: 66ch;
	}
	.sub b {
		color: var(--text);
		font-weight: 600;
	}
	/* The short laptop's sub-line, after .sub so it wins (same specificity): The machine
	   surface's line takes the same 16.5 px (#connect .lead). */
	@media (min-width: 1000px) and (max-height: 760px) {
		.sub {
			font-size: 16.5px;
		}
	}

	.endpoint {
		display: flex;
		align-items: center;
		border: 1px solid rgba(45, 212, 191, 0.35);
		border-radius: 10px;
		background: rgba(45, 212, 191, 0.06);
		overflow: hidden;
		max-width: 100%;
	}
	.endpoint code {
		padding: 11px 14px;
		color: var(--teal-2);
		font-size: 14px;
		white-space: nowrap;
		overflow-x: auto;
	}
	.endpoint button {
		border: 0;
		border-left: 1px solid rgba(45, 212, 191, 0.28);
		background: rgba(45, 212, 191, 0.14);
		color: var(--teal-2);
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		padding: 11px 15px;
		cursor: pointer;
		/* The label swaps between Copy and Copied; without a floor the button - and
		   the box around it - visibly resizes on every click. */
		min-width: 78px;
	}
	.endpoint button:hover {
		background: rgba(45, 212, 191, 0.26);
	}
	/* ---------- terminal ---------- */
	.term {
		border: 1px solid var(--line);
		border-radius: 14px;
		background: #0b1120;
		overflow: hidden;
		box-shadow: 0 40px 90px -50px #000;
	}
	.term-bar {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 11px 15px;
		border-bottom: 1px solid var(--line-2);
		background: #1f2937;
	}
	.term-bar i {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #4b5563;
	}
	.term-bar .t {
		margin-left: 10px;
		font-size: 11.5px;
		color: var(--dim);
		white-space: nowrap;
	}
	.term-bar .tag {
		margin-left: auto;
		font-size: 11px;
		color: var(--dim);
	}
	@media (max-width: 520px) {
		.term-bar .tag {
			display: none;
		}
	}
	.term pre {
		margin: 0;
		padding: 18px 16px 22px;
		font-size: 12.5px;
		line-height: 1.8;
		color: #d1d5db;
		/* pre-wrap, not pre: the register command is longer than a phone is wide, and
		   a horizontally scrolling terminal hides exactly the part worth reading. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		min-height: 360px;
	}
	@media (min-width: 700px) {
		.term pre {
			font-size: 13px;
			padding: 22px;
		}
	}
	/* Set by the transcript's own markup, so they are global to this component. */
	.landing :global(.u) {
		color: var(--teal-2);
	}
	.landing :global(.k) {
		color: var(--gold);
	}
	.landing :global(.d) {
		color: var(--dim);
	}
	.landing :global(.g) {
		color: var(--green);
	}
	.landing :global(.p) {
		color: var(--purple);
	}
	.landing :global(.caret) {
		display: inline-block;
		width: 8px;
		height: 15px;
		vertical-align: -2px;
		background: var(--teal-2);
		animation: bl 1s steps(1) infinite;
	}
	@keyframes bl {
		50% {
			opacity: 0;
		}
	}

	/* ---------- section scaffolding ---------- */
	section {
		padding: 66px 0;
		border-top: 1px solid var(--line-2);
	}
	.sec-num {
		font-size: 11.5px;
		letter-spacing: 0.18em;
		color: var(--dim);
		text-transform: uppercase;
		margin-bottom: 14px;
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.sec-num .n {
		color: var(--teal);
	}
	h2 {
		margin: 0 0 12px;
		font-size: clamp(25px, 4vw, 38px);
		letter-spacing: -0.028em;
		font-weight: 650;
		line-height: 1.12;
	}
	.lead {
		color: var(--muted);
		max-width: 62ch;
		margin: 0 0 30px;
		font-size: 15.5px;
	}

	/* ---------- harnesses ---------- */
	.h-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 14px;
	}
	.h-tab {
		border: 1px solid var(--line);
		background: var(--panel);
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		padding: 6px 12px;
		border-radius: 8px;
		cursor: pointer;
		transition: color 0.16s, border-color 0.16s, background 0.16s;
	}
	.h-tab:hover {
		color: var(--text);
		border-color: #4b5563;
	}
	.h-tab[aria-selected='true'] {
		color: var(--teal-2);
		border-color: rgba(45, 212, 191, 0.45);
		background: rgba(45, 212, 191, 0.1);
	}
	.h-panel {
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--panel);
		padding: 16px 18px;
	}
	.h-path {
		margin: 0 0 10px;
		font-size: 12.5px;
		color: var(--dim);
	}
	.h-path code {
		color: var(--muted);
	}
	.h-code {
		position: relative;
	}
	.h-code pre {
		margin: 0;
		background: #0b1120;
		border: 1px solid var(--line-2);
		border-radius: 9px;
		padding: 13px 86px 13px 14px;
		font-size: 12.5px;
		line-height: 1.75;
		color: var(--teal-2);
		/* pre-wrap, not a scroller: the register command is wider than a phone, and a
		   scrolling line runs straight under the Copy button - padding-right only
		   reserves space past the END of the content, which a scroller never shows. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.h-copy {
		position: absolute;
		top: 9px;
		right: 9px;
		border: 1px solid rgba(45, 212, 191, 0.28);
		background: rgba(45, 212, 191, 0.12);
		color: var(--teal-2);
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		padding: 5px 11px;
		border-radius: 7px;
		cursor: pointer;
		/* Same reason as the endpoint button: the Copy/Copied swap must not resize it,
		   and here a resize would also reflow the pre's reserved padding. */
		min-width: 68px;
	}
	.h-copy:hover {
		background: rgba(45, 212, 191, 0.24);
	}
	.h-note {
		margin: 10px 0 0;
		font-size: 12.5px;
		color: var(--dim);
	}
	.h-more {
		margin-top: 14px;
		font-size: 13.5px;
		color: var(--muted);
	}
	.h-more summary {
		cursor: pointer;
	}

	/* ---------- pipeline ---------- */
	.pipe {
		display: grid;
		gap: 14px;
		grid-template-columns: 1fr;
	}
	@media (min-width: 860px) {
		.pipe {
			grid-template-columns: repeat(4, 1fr);
			gap: 0;
		}
	}
	.step {
		position: relative;
		padding: 20px 18px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--panel);
	}
	@media (min-width: 860px) {
		.step {
			border-radius: 0;
			border-right: 0;
		}
		.step:first-child {
			border-radius: 12px 0 0 12px;
		}
		.step:last-child {
			border-radius: 0 12px 12px 0;
			border-right: 1px solid var(--line);
		}
	}
	.step .i {
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--teal);
		margin-bottom: 8px;
	}
	.step h4 {
		margin: 0 0 6px;
		font-size: 15.5px;
		font-weight: 600;
	}
	.step p {
		margin: 0;
		font-size: 13px;
		color: var(--muted);
	}
	.step .beam {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		width: 0;
		background: var(--teal);
		opacity: 0.7;
	}

	/* ---------- the MCP bar, under the roster ---------- */
	.mcpbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px 18px;
		padding: 11px 16px;
		border: 1px solid rgba(45, 212, 191, 0.3);
		border-radius: 12px;
		background: rgba(45, 212, 191, 0.05);
	}
	.mb-k {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 0 0 auto;
	}
	.mark-prompt {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 16px;
		font-weight: 700;
		color: var(--teal-2);
		letter-spacing: -0.04em;
		flex: 0 0 auto;
	}
	.mb-k b {
		font-size: 16px;
		font-weight: 650;
		line-height: 1.1;
	}
	.mb-k small {
		display: block;
		font-size: 10.5px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--dim);
	}
	.mcpbar .endpoint {
		flex: 0 1 auto;
		min-width: 0;
	}
	.mb-facts {
		font-size: 13px;
		color: var(--muted);
		flex: 1 1 14rem;
		min-width: 0;
	}
	.landing .mb-go {
		margin-left: auto;
		font-size: 13.5px;
		font-weight: 600;
		white-space: nowrap;
		padding: 7px 12px;
		border-radius: 8px;
		color: var(--teal-2);
		border: 1px solid rgba(45, 212, 191, 0.4);
		background: rgba(45, 212, 191, 0.09);
	}
	.landing .mb-go:hover {
		background: rgba(45, 212, 191, 0.2);
	}
	@media (max-width: 760px) {
		.mcpbar .endpoint code {
			font-size: 13px;
			padding: 10px 12px;
		}
	}
	/* A phone: Connect moves up beside "MCP for your agent", the endpoint takes the second row
	   and the sentence the third, across the bar. */
	@media (max-width: 560px) {
		.mb-go {
			order: 1;
		}
		.mcpbar .endpoint {
			order: 2;
		}
		.mb-facts {
			order: 3;
			flex: 1 1 100%;
			line-height: 1.45;
		}
	}

	/* ---------- The machine surface ---------- */
	/* Its line under the heading takes the headline sub-line's type. */
	#connect .lead {
		font-size: clamp(15px, 1.7vw, 17.5px);
		line-height: 1.5;
	}
	@media (min-width: 1000px) and (max-height: 760px) {
		#connect .lead {
			font-size: 16.5px;
		}
	}
	.conn-term {
		margin: 4px 0 26px;
	}

	/* The reveal gate, deliberately INVERTED: elements are visible by default and are
	   hidden only once `has-gsap` confirms the library loaded (the gate script in
	   <svelte:head> stamps it before first paint). A failed asset therefore leaves a
	   plain readable page rather than an invisible one. */
	:global(.has-gsap) .rv {
		opacity: 0;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.has-gsap) .rv {
			opacity: 1;
		}
		.landing :global(.caret) {
			animation: none;
		}
	}
</style>
