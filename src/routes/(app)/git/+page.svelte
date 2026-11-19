<script lang="ts">
	// The /git domain: Git on Nostr - NIP-34 (git collaboration) - measured from the Nozzl
	// event archive. The server load hands this page the newest ngit_snapshot row - the
	// whole dataset as ONE precomputed document, written nightly by nostrology-data's
	// ngit_refresh Dagster job (pipeline/ngit.py). Nothing here is computed per request, and
	// nothing renders that is not in the document: the page's own derivations are
	// presentation only (npub encoding for links, percentages, msats -> sats, gap-filling
	// the elided days of the cumulative series, and the headline GRASP or hashtree share,
	// two of the document's counts summed over a third).
	//
	// Contract: nostrology-data docs/design/ngit-design.md section 8 (mirrored by NgitSnapshot).
	// What every number counts: nostrology-data's docs/dataset-reference/ngit-dataset-reference.md - the copy on
	// this page paraphrases it, and where they differ the reference is right.
	//
	// Launched on 2026-10-15, with the redesigned landing: in the nav as Git-on-Nostr, on the
	// landing's board, in the sitemap, indexable. It incubated from 2026-09-25, linked from /wip
	// only.
	import { onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import type { NgitListsFrom, NgitSnapshot } from '$lib/shared/data-types';
	import HBar from '$lib/components/markets/HBar.svelte';
	import Donut from '$lib/components/markets/Donut.svelte';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import StackedBars from '$lib/components/ngit/StackedBars.svelte';
	import SmallLine from '$lib/components/ngit/SmallLine.svelte';
	import RepoTable from '$lib/components/ngit/RepoTable.svelte';
	import RepoLink from '$lib/components/ngit/RepoLink.svelte';
	import LedgerRow from '$lib/components/ngit/LedgerRow.svelte';
	import SortTh from '$lib/components/ngit/SortTh.svelte';
	import {
		CLONE_HOST_KIND_LABEL,
		cloneHostLabel,
		cloneHostTitle,
		counted,
		cutOf,
		dayName,
		fmtDay,
		HOST_KIND_LABEL,
		hostClassKind,
		hostKindsInOrder,
		HOSTING_CLASS_DEF,
		HOSTING_CLASS_LABEL,
		labelFor,
		labelText,
		n,
		pct,
		personLabel,
		repoLabel,
		satsFromMsats,
		sortNote,
		upperFirst,
		type Noun
	} from '$lib/ngit/format';
	import { njumpUrl } from '$lib/ngit/links';
	import { METHODOLOGY } from '$lib/methodology';
	import MethodologySection from '$lib/components/MethodologySection.svelte';
	import TransientNote from '$lib/components/TransientNote.svelte';
	import SectionLink from '$lib/components/SectionLink.svelte';
	import PillBar from '$lib/components/PillBar.svelte';
	import { domainPage } from '$lib/domain-page';
	import { addressOf, own, pageTitle, type Target } from '$lib/slug-table';
	import { GIT_SLUGS } from '$lib/slug-tables/git';
	import { nearestTop } from '$lib/section-link';
	import {
		AMBER,
		BLUE,
		GRASP_COLOR,
		GREEN,
		hostingColor,
		hostKindColor,
		NEUTRAL_SERIES,
		OTHERS_COLOR,
		PINK,
		PURPLE,
		RELAYS_PER_REPO_COLOR,
		TEAL
	} from '$lib/ngit/palette';
	import {
		fillDaily,
		flooredWindowStart,
		inWindow,
		isoMonday,
		showLeaderboard,
		sortRows,
		sumOf,
		valuesOf,
		windowWithTotal,
		yearWindowStart,
		type SortDir
	} from '$lib/ngit/series';
	import { sortInk } from '$lib/sort-ink';

	/** `listsFrom`: whether the server took the Stars and Zaps lists from ngit_repo_stats or
	 * kept the document's own (absent where a caller passes a document alone, as the tests do).
	 * `target`: what the address names, as the server answered it ($lib/slug-table): the page
	 * is served at every /git/<slug> too - /git/hosting opens Hosting, /git/zaps opens
	 * Collaboration at the Zaps section. Absent where a test passes a document alone, which is
	 * the bare /git. */
	export let data: { snapshot: NgitSnapshot; listsFrom?: NgitListsFrom; target?: Target };
	// Bound once at init. A move between this page's addresses - a pill click, the nav's Git
	// link on /git/zaps - keeps this component and hands it new `data`, but the same document:
	// the layout's load, which fetches it, does not run again (+layout.server.ts). Only
	// `data.target` is read again ($lib/domain-page).
	const D = data.snapshot;
	const s = D.summary;
	const cov = D.coverage;

	// The pills are /git's slug table's (GIT_SLUGS), and so is everything about which one is
	// open, What is counted, the note and opening at a section: $lib/domain-page, shared by
	// every domain page. The pill comes from the server's answer for the address, so the HTML
	// it sent already shows it: /git/zaps arrives on Collaboration with no flash of Overview.
	const { tab, methodologyOpen, note, pick } = domainPage(GIT_SLUGS, () => data.target);
	/** The section the address names (/git/zaps), from the slug table: a section with a preview
	 * of its own draws it. */
	$: section =
		data.target?.kind === 'page' && data.target.section ? own(GIT_SLUGS.sections, data.target.section) : undefined;
	// The link icon on each section with an address (SectionLink): on a phone it is drawn on
	// one card only, the section whose heading is on screen nearest the top (P1, the
	// operator's choice, 2026-10-19), worked out again - once a frame at most - as the page
	// scrolls, resizes or shifts with no scroll at all (a <details> above closing moves the
	// headings under a still page), and whenever the open pill changes which headings exist.
	// What is counted's own icon is drawn by hover only, never on a phone, and the section closes
	// its pill, so it can never be nearer the top than a section with an icon of this kind.
	const LINKED = Object.entries(GIT_SLUGS.sections);
	let phoneLink: string | null = null;
	function placePhoneLink() {
		const navBottom = document.querySelector('nav.nav')?.getBoundingClientRect().bottom ?? 0;
		const heads = LINKED.flatMap(([slug, sec]) => {
			const h = document.getElementById(sec.elementId)?.querySelector('h2');
			if (!h) return [];
			const r = h.getBoundingClientRect();
			return [{ name: slug, top: r.top, bottom: r.bottom }];
		});
		phoneLink = nearestTop(heads, navBottom, window.innerHeight);
	}
	let placing = 0;
	function schedulePlace() {
		if (!placing)
			placing = requestAnimationFrame(() => {
				placing = 0;
				placePhoneLink();
			});
	}
	onMount(() => {
		placePhoneLink();
		window.addEventListener('scroll', schedulePlace, { passive: true });
		window.addEventListener('resize', schedulePlace);
		const shifts = typeof ResizeObserver === 'function' ? new ResizeObserver(schedulePlace) : undefined;
		shifts?.observe(document.body);
		return () => {
			window.removeEventListener('scroll', schedulePlace);
			window.removeEventListener('resize', schedulePlace);
			shifts?.disconnect();
			cancelAnimationFrame(placing);
		};
	});
	$: if (browser && $tab) void tick().then(placePhoneLink);
	// A plain click on a pill (PillBar's onPick; the router's navigation follows). On a phone
	// the pill bar is drawn above six stacked cards and the panel it opens starts below them,
	// off screen, so a tap would change nothing in view: when the new panel's top is not on
	// screen, scroll to it, keeping the sticky nav's height (measured, not assumed) and a small
	// gap above it. Not for the keyboard: Enter leaves focus on the pill, which has to stay on
	// screen (the next Tab would jump the page back to it). The pill links keep the scroll
	// otherwise (data-sveltekit-noscroll).
	async function tap(slug: string, byKeyboard: boolean) {
		pick(slug);
		if (byKeyboard) return;
		await tick();
		const panel = document.getElementById('panel-' + slug);
		if (!panel) return;
		const top = panel.getBoundingClientRect().top;
		if (top >= 0 && top <= window.innerHeight) return;
		const nav = document.querySelector('nav.nav')?.getBoundingClientRect().height ?? 0;
		window.scrollTo({ top: window.scrollY + top - nav - 8 });
	}

	// Colours ($lib/ngit/palette): a hosting class wears its own colour in the donut on
	// Hosting, and a kind of host the donut's colour for its kind (HOST_KIND_COLOR: GRASP
	// purple, hashtree pink, Self-hosted green, Forges amber, none slate) wherever the kinds are
	// drawn - Clone hosts below the donut (the operator's choice, 2026-10-10) and New
	// repositories per week on Overview, whose line takes the neutral ink - so each kind is one
	// colour on the whole page since the operator's swap of the donut's blue and amber
	// (2026-10-12). The headline share of GRASP or hashtree is white like the other cards: it
	// spans three classes, so no class colour is its own. All repositories take the neutral
	// ink. Hosting's other single-series bar lists take the neutral ink too, except GRASP
	// servers per repository, which is GRASP, and Relays per repository beside it, which wears
	// blue at the operator's choice (2026-10-08). Overview's push charts keep the site colours
	// they had.

	// "observation", not "capture", in public wording: the operator's preference (2026-10-18)
	const WALL_NOTE = 'before observation began: only what relays still served';
	// The nouns of the top-N captions (cutOf): "the top 20 of 64 servers", "the only server".
	const REPOS: Noun = ['repository', 'repositories'];
	const HOSTS: Noun = ['host', 'hosts'];
	const SERVERS: Noun = ['server', 'servers'];
	const MAINTAINERS: Noun = ['maintainer', 'maintainers'];
	const TOPICS: Noun = ['topic', 'topics'];
	const RELAYS: Noun = ['relay', 'relays'];
	// Third-party labels in HBar lists (hosts, relays, topics) sit in a wrapper with
	// overflow-wrap: anywhere - it is inherited, so a 100-character host breaks instead of
	// widening its column past a phone screen - and every grid child is min-w-0. The Stars and
	// Zaps tables have no horizontal scroll, so their names break anywhere too (RepoLink's
	// wrapAnywhere: its own break-words would override an inherited value).
	// Every {#each} over document rows is keyed by INDEX, never by a value from the rows:
	// Svelte 5 throws on a duplicate key even in production, and hosts, identifiers and names
	// are third-party strings (hosts clipped at 100 can collide once clipped) - one crafted
	// or buggy duplicate would take the whole page down on hydration.
	// Every third-party string shown passes labelText / personLabel / repoLabel /
	// cloneHostLabel / cloneHostTitle ($lib/ngit/format), which remove the control and format
	// characters that reorder or hide text, and each name is isolated: in its own <bdi>, or, as
	// an HBar label, in a grid item of its own.

	// The hosting donut's hashtree class ("hashtree, no GRASP"): the repositories with an
	// htree:// clone URL and no GRASP server. Real documents write all six classes; a class
	// the document lacks counts 0.
	const hashtreeRepos = D.hosting.find((h) => h.k === 'hashtree')?.v ?? 0;
	// The headline share, on the card and in the donut's centre: the repositories on a GRASP
	// server or hashtree, over all of them, so that neither is singled out (the operator's
	// choice, 2026-10-10; it was GRASP's alone, summary.grasp_share). The six classes are
	// exclusive (reference 4.4: a repository on both is grasp_mixed), so GRASP-hosted
	// (grasp_only + grasp_mixed) plus the hashtree class counts each such repository once:
	// it is the donut's first three classes. 0 when there are no repositories, as the
	// reference's shares are.
	const graspOrHashtreeRepos = s.grasp_repos + hashtreeRepos;
	const graspOrHashtreeShare = s.repos > 0 ? graspOrHashtreeRepos / s.repos : 0;

	// --- Overview -------------------------------------------------------------------------
	const CARDS: { l: string; v: string; sub?: string }[] = [
		{ l: 'Repositories', v: n(s.repos) },
		{
			l: 'Active repositories (30 d)',
			v: n(s.repos_pushed_30d),
			sub: `${n(s.repos_pushed_90d)} pushed in the last 90 days`
		},
		{
			l: 'Pushes (30 d)',
			v: n(s.pushes_30d),
			sub: `${n(s.pushes_7d)} in the last 7 days`
		},
		{
			l: 'Maintainers',
			v: n(s.maintainers),
			sub: `${n(s.maintainers_active_30d)} pushed in the last 30 days`
		},
		{
			l: 'GRASP or hashtree share',
			v: pct(graspOrHashtreeShare),
			sub: `${n(graspOrHashtreeRepos)} repositories on GRASP servers or hashtree`
		},
		{
			l: 'Comments (30 d)',
			v: n(s.comments_30d),
			// comments_90d is absent from a document written before 2026-10-02: no sub-line then.
			sub: s.comments_90d === undefined ? undefined : `${n(s.comments_90d)} in the last 90 days`
		}
	];

	// kind-17 (external-content-reactions), Iris Git's stars, is read since the first run after
	// the nostrology-data deploy of 2026-10-11 (dataset reference 6.2). A document written
	// before it lacks the kind's input count, and its stars are kind-7 (reactions) alone: the
	// page then describes them as it did before - no kind-17 (external-content-reactions) source
	// row, the old Stars card definition and the old unstar caveat.
	const irisCounted = s.archive_events.external_reactions !== undefined;
	// Since the nostrology-data deploy of 2026-10-12 a hashtree repository's push is counted, read
	// from the announcement its git tool republishes with each ref of a public push, republishes
	// less than two minutes apart counting once (dataset reference section 3).
	// A document written before that carries no pushes_hashtree_30d and counts none, and the page
	// then words the push figures as it did before.
	const hashtreePushes = s.pushes_hashtree_30d;
	const hashtreeCounted = hashtreePushes !== undefined;
	// The last three capture dates are optional: a document written before 2026-09-25
	// lacks them, and the table then says so in words rather than printing a dash. No row
	// counts: the archive's per-kind totals are not a figure this page reports.
	const SOURCES = [
		{
			kind: 'kind-30617 (repo-announcements)',
			role: hashtreeCounted ? "the repository roster, and hashtree's pushes" : 'the repository roster',
			since: cov.announcements_since
		},
		{ kind: 'kind-30618 (repo-states)', role: 'branch and tag tips, and so pushes', since: cov.states_since },
		{ kind: 'kind-10317 (grasp-server-lists)', role: 'the GRASP servers a user wants', since: cov.states_since },
		{ kind: 'kind-1111 (comments)', role: 'replies on issues, pull requests, patches and repositories (the git subset)', since: cov.comments_since },
		{ kind: 'kind-7 (reactions)', role: 'stars (reactions to a repository)', since: cov.reactions_since ?? null },
		...(irisCounted
			? [
					{
						kind: 'kind-17 (external-content-reactions)',
						role: 'Iris Git stars and unstars (reactions to a repository by its address)',
						since: cov.external_reactions_since ?? null
					}
				]
			: []),
		{ kind: 'kind-9735 (zap-receipts)', role: 'zaps to repositories', since: cov.zaps_since ?? null },
		{ kind: 'kind-5 (event-deletion-requests)', role: 'withdrawals by the author (author and repository pairs, not events)', since: cov.deletions_since ?? null }
	];
	// The page names no source relay (the operator's choice, 2026-10-09): the list changes
	// whenever nozzl onboards a relay, and a page that named them went stale with every
	// change. nostrology-data's docs/dataset-reference/ngit-dataset-reference.md, section 0 item 1, carries the list.
	// An empty extract is not a measured zero: the input counts say which one a 0 is.
	const reactionsRead = s.archive_events.reactions > 0;
	// Stars come from either input; the total is an empty input only when neither was read.
	const starsRead = reactionsRead || (s.archive_events.external_reactions ?? 0) > 0;
	const zapsRead = s.archive_events.zaps > 0;
	const futureDated = sumOf(Object.values(D.anomalies.future_dated), (v) => v);
	const pastDated = sumOf(Object.values(D.anomalies.past_dated), (v) => v);
	// hashtree's pushes publish no kind-30618 (repo-states): a document that counts none of them
	// (no pushes_hashtree_30d, dataset reference section 8) says so for the hosting donut's
	// hashtree class (hashtreeRepos)
	const hashtreeScope =
		hashtreeRepos === 0 ? '' : hashtreeRepos === 1 ? ' for its one repository' : ` for its ${n(hashtreeRepos)} repositories`;
	const announcementRows = D.exclusions.filter((e) => e.unit === 'announcements');
	const otherUnitRows = D.exclusions.filter((e) => e.unit !== 'announcements');
	const commentLedger = D.exclusions.filter((e) => e.unit === 'comments');

	// Time charts end at as_of_day and span at most a year (the document still carries each
	// series from its start; the page cuts it). The cumulative chart spans the trailing year of
	// days and fades the days before announcement capture. Every weekly chart starts no
	// earlier than the week holding WEEKLY_FROM, the first month after every capture wall
	// (announcements 2026-05-02, states and GRASP lists 2026-06-14, comments 2026-06-18): no
	// week mixes what relays still served with what was captured, so the only key a weekly
	// chart carries is the week still filling. From 2027-07 they span the trailing year too.
	const WEEKLY_FROM = '2026-07-01';
	const yearDay = yearWindowStart(D.as_of_day, 'day');
	const weekStart = flooredWindowStart(D.as_of_day, 'week', WEEKLY_FROM);
	const partialWeekNote = `partial week: data to ${dayName(D.as_of_day)}`;

	// Filled over the whole series first, so the window's first day carries the running total.
	const cumWin = inWindow(fillDaily(D.cum_repos, D.as_of_day), (p) => p.d, yearDay, 'day');
	// What is counted says the cumulative chart fades the days before capture only while its
	// trailing year still reaches back that far (until 2027-05).
	const cumFades = cumWin.labels.length > 0 && cumWin.labels[0] < cov.announcements_since;
	// ALL repositories: the neutral ink, the colour of no category.
	const cumSeries = [{ label: 'Repositories', color: NEUTRAL_SERIES, values: valuesOf(cumWin.rows, (p) => p.v) }];

	// The three weekly series of 2026-10-02 (new repositories, comments, GRASP list users) are
	// absent from a document written before then: each chart then says so instead of drawing.
	const NOT_IN_SNAPSHOT = 'Not in this snapshot: it was written before the weekly series were added.';
	const newWin = inWindow(D.new_repos_weekly ?? [], (r) => r.w, weekStart, 'week');
	// One bar per kind of host, side by side (2026-10-08): a repository counts under every kind
	// it is on (a GRASP server and a GitHub mirror under both GRASP and Forges), so the bars can
	// add up to more than the week's new repositories, which the tooltip gives instead. The
	// kinds the first row carries, each once, in the page's order whatever the document's -
	// GRASP, hashtree, Self-hosted, Forges, then No public host (HOST_KIND_ORDER, the operator's,
	// 2026-10-12), bars and key alike, and a kind the page does not know yet after them - each
	// read by key from every row's by_host; a kind a row lacks is a gap (null), never a zero. A
	// document written before the first run after the 2026-10-08 deploy has the weekly rows
	// without by_host, and the chart says so.
	const NOT_BY_HOST = 'Not in this snapshot: it was written before the count by kind of host was added.';
	const newByHost = (D.new_repos_weekly ?? []).every((r) => Array.isArray(r.by_host));
	const hostKinds = hostKindsInOrder((D.new_repos_weekly?.[0]?.by_host ?? []).map((c) => c.k as string));
	const newReposSeries = hostKinds.map((k) => ({
		label: labelFor(HOST_KIND_LABEL, k),
		color: hostKindColor(k),
		values: valuesOf(newWin.rows, (r) => r.by_host?.find((c) => c.k === k)?.v ?? null)
	}));
	const newReposTotals = valuesOf(newWin.rows, (r) => r.v);
	// The neutral ink: BTC_ORANGE was too close to the Forges amber (HOST_KIND_COLOR).
	const firstTimeLine = {
		label: 'First-time maintainers',
		color: NEUTRAL_SERIES,
		values: valuesOf(newWin.rows, (r) => r.s),
		axisLabel: 'first-time maintainers'
	};

	const pushWin = inWindow(D.pushes_weekly, (r) => r.w, weekStart, 'week');
	const weeks = pushWin.labels;
	const pushSeries = [{ label: 'Pushes', color: TEAL, values: valuesOf(pushWin.rows, (r) => r.pushes) }];
	const pushedSeries = [
		{ label: 'Repositories pushed', color: BLUE, values: valuesOf(pushWin.rows, (r) => r.repos) },
		{ label: 'Maintainers pushing', color: AMBER, values: valuesOf(pushWin.rows, (r) => r.maintainers) }
	];

	// --- Repositories ---------------------------------------------------------------------
	const bucketRows = (rows: { k: string; v: number }[]) => rows.map((r) => ({ label: r.k, value: r.v }));

	// --- Repositories and Hosting: third-party labels ------------------------------------
	const topicRows = D.topics.map((t) => ({ label: labelText(t.t), value: t.repos }));
	const relayRows = D.relays.map((r) => ({ label: labelText(r.relay), value: r.repos }));
	// The document carries the top 12 web hosts and the top 30 clone hosts (dataset reference
	// 4.5); the page shows fewer. Each list is ranked by repositories, ties by host, so its
	// first rows are the same top N a smaller cap in the pipeline would write.
	const WEB_HOSTS_SHOWN = 10;
	const CLONE_HOSTS_SHOWN = 20;
	const webHostRows = D.web_hosts.slice(0, WEB_HOSTS_SHOWN).map((w) => ({ label: labelText(w.host), value: w.repos }));

	// --- Hosting --------------------------------------------------------------------------
	const hostingRows = D.hosting.map((r) => ({ label: labelFor(HOSTING_CLASS_LABEL, r.k), value: r.v }));
	// By class key, never by position: a class keeps its colour whatever the order or counts.
	const hostingColors = D.hosting.map((r) => hostingColor(r.k));
	// Each class's share beside its count, in whole percents as Servers per list gives its
	// buckets' (the operator's request, 2026-10-10). The whole is the classes' own sum, the one
	// the donut's hover divides by, so list and hover agree by construction; the smoke test holds
	// that sum equal to the Repositories card. Each share is rounded on its own, so GRASP only,
	// GRASP + other hosts and hashtree add up to the centre's one-decimal share only roughly.
	const hostingTotal = D.hosting.reduce((t, r) => t + r.v, 0);
	const classShare = (v: number) => pct(hostingTotal > 0 ? v / hostingTotal : 0, 0);
	// A host's bar wears the donut's colour for its kind of host, where a "(GRASP)" after the
	// name used to mark the GRASP servers (the operator's choice, 2026-10-10). Two of those
	// colours, the hashtree pink and the self-hosted green, are close under colour-vision
	// deficiency (palette.ts), so the kind is in words where words reach: a screen reader reads
	// it after the name, and a hover on the bar's track shows it. On a touch screen the key ties
	// kinds to bars by colour alone, except a hashtree npub's bar, whose label starts htree://.
	const cloneHosts = D.clone_hosts.slice(0, CLONE_HOSTS_SHOWN).map((h) => ({ ...h, kind: hostClassKind(h.cls) }));
	// A hashtree host is its owner's npub, shown short after "htree://" (cloneHostLabel), with
	// the whole npub on hover.
	const cloneHostRows = cloneHosts.map((h) => ({
		label: cloneHostLabel(h),
		labelTitle: cloneHostTitle(h),
		value: h.repos,
		color: hostKindColor(h.kind),
		category: labelFor(CLONE_HOST_KIND_LABEL, h.kind)
	}));
	// The key: each kind the bars shown wear, once, in New repositories per week's order
	// (HOST_KIND_ORDER: GRASP, hashtree, Self-hosted, Forge, then Not public, the operator's,
	// 2026-10-12); a kind the page does not know yet goes last.
	const cloneHostKinds = hostKindsInOrder(cloneHosts.map((h) => h.kind));

	// Sortable tables render the document's own ranking until a header is clicked (the
	// maintainers and zaps tables: sorted by their marked column from the start), and a
	// sort keeps document order among equal keys (sortRows is stable): the document ranks
	// on finer keys than the columns show (maintainers: pushes in 90 d, then repositories,
	// then pubkey; stars: then the repository key; zaps: receipts, then msats, finer than the
	// sats shown, then the key).
	/** A header click: the active column flips; a new column starts descending, or
	 * ascending when it holds text. */
	function nextSort<K extends string>(key: K, dir: SortDir, clicked: string, textKey: string): [K, SortDir] {
		if (clicked === key) return [key, dir === 'asc' ? 'desc' : 'asc'];
		return [clicked as K, clicked === textKey ? 'asc' : 'desc'];
	}
	type GraspKey = 'host' | 'repos' | 'users';
	let graspKey: GraspKey = 'repos';
	let graspDir: SortDir = 'desc';
	let graspUserSorted = false;
	function sortGrasp(key: string) {
		[graspKey, graspDir] = nextSort(graspKey, graspDir, key, 'host');
		graspUserSorted = true;
	}
	$: graspSorted = graspUserSorted ? sortRows(D.grasp_servers, graspKey, graspDir) : D.grasp_servers;

	// --- Maintainers ----------------------------------------------------------------------
	type MaintKey = 'who' | 'repos' | 'pushes_90d' | 'last_push';
	const maintainers = D.maintainers_top.map((m) => ({
		pubkey: m.pubkey,
		who: personLabel(m.name, m.pubkey),
		href: njumpUrl(m.pubkey),
		repos: m.repos,
		pushes_90d: m.pushes_90d,
		last_push: fmtDay(m.last_push) === '-' ? null : fmtDay(m.last_push)
	}));
	// The document ranks by pushes in 90 d (dataset reference 5.1), so that is the column
	// marked as sorted before any click - and the rows are ALWAYS sorted by the marked
	// column: over a new document the stable sort leaves its order untouched, and over one
	// written before the cut changed (2026-09-29) the marker still tells the truth.
	let maintKey: MaintKey = 'pushes_90d';
	let maintDir: SortDir = 'desc';
	/** A maintainer's figure in the column sorted at the moment, for the line under the name on
	 * a phone; null for a sort by name. */
	function maintLine(m: (typeof maintainers)[number], key: MaintKey): string | null {
		if (key === 'repos') return counted(m.repos, REPOS);
		if (key === 'pushes_90d') return `${counted(m.pushes_90d, ['push', 'pushes'])} in 90 d`;
		if (key === 'last_push') return `last push ${m.last_push ?? '-'}`;
		return null;
	}
	function sortMaint(key: string) {
		[maintKey, maintDir] = nextSort(maintKey, maintDir, key, 'who');
	}
	$: maintSorted = sortRows(maintainers, maintKey, maintDir);
	// New users per week as bars, and the running total as a line on its own axis. per_week
	// starts with the states wall's week, so the total starts from the users first seen
	// before it (users minus the weekly sum) and runs over the whole series before the window
	// cuts it: its first point counts everyone who published a list earlier.
	const graspWeekly = D.grasp_lists.per_week ?? [];
	const graspBefore = Math.max(0, D.grasp_lists.users - sumOf(graspWeekly, (r) => r.v));
	const graspWin = windowWithTotal(graspWeekly, (r) => r.w, (r) => r.v, weekStart, 'week', graspBefore);
	const graspListSeries = [{ label: 'New users', color: GRASP_COLOR, values: graspWin.values }];
	const graspTotalLine = { label: 'Total', color: AMBER, values: graspWin.totals, axisLabel: 'total' };

	// --- Collaboration --------------------------------------------------------------------
	const commentWin = inWindow(D.comments_weekly ?? [], (r) => r.w, weekStart, 'week');
	// Five root kinds, the design's five: issues / PRs / patches / repository / other.
	// "other" (a comment admitted only by its repository tag) takes the neutral slate. This
	// pill shows no hosting class, so the site palette is used freely here.
	const commentSeries = [
		{ label: 'Issues', color: PURPLE, values: valuesOf(commentWin.rows, (r) => r.issues) },
		{ label: 'Pull requests', color: TEAL, values: valuesOf(commentWin.rows, (r) => r.prs) },
		{ label: 'Patches', color: BLUE, values: valuesOf(commentWin.rows, (r) => r.patches) },
		{ label: 'Repository', color: PINK, values: valuesOf(commentWin.rows, (r) => r.repo) },
		{ label: 'Other', color: OTHERS_COLOR, values: valuesOf(commentWin.rows, (r) => r.other) }
	];
	// Threads outnumber authors several times over: each gets its own axis, so the authors
	// line is not flattened against the threads' scale.
	const authorsSeries = [{ label: 'Authors', color: AMBER, values: valuesOf(commentWin.rows, (r) => r.authors) }];
	const threadsLine = {
		label: 'Threads',
		color: GREEN,
		values: valuesOf(commentWin.rows, (r) => r.threads),
		axisLabel: 'threads'
	};

	// Stars and zaps: the top 20 of each, which the page's server reads from ngit_repo_stats for
	// the document's run since 2026-10-18 (the document's own top 20 otherwise, the
	// top 10 before the first run after the nostrology-data deploy of 06:14Z that
	// day), sortable like the maintainers. `label` is the name as shown, so a sort by name
	// follows what is read. The two cards carry data-lists, the path the lists came by.
	type StarKey = 'label' | 'stars';
	const starred = D.repos_starred.map((r) => ({ ...r, label: repoLabel(r) }));
	let starKey: StarKey = 'stars';
	let starDir: SortDir = 'desc';
	let starUserSorted = false;
	function sortStars(key: string) {
		[starKey, starDir] = nextSort(starKey, starDir, key, 'label');
		starUserSorted = true;
	}
	$: starSorted = starUserSorted ? sortRows(starred, starKey, starDir) : starred;
	// Zaps opens sorted by receipts since 2026-10-18 (the operator's ask), and the document
	// ranks by them, then by sats, from that day's second nostrology-data deploy (dataset
	// reference 6.3 has its time; by sats, then receipts before). Like the maintainers' rows
	// these are ALWAYS sorted by the marked column, so a document ranked by sats opens by
	// receipts too, its order kept among equal counts. The cut ("The top 20 repositories.")
	// is the top by receipts only if the document ranks by them: true of a document ranked by
	// sats only while it lists every zapped repository, and the smoke test holds a cut list to
	// the receipts ranking.
	type ZapKey = 'label' | 'msats' | 'receipts';
	const zapped = D.repos_zapped.map((r) => ({ ...r, label: repoLabel(r) }));
	let zapKey: ZapKey = 'receipts';
	let zapDir: SortDir = 'desc';
	function sortZaps(key: string) {
		[zapKey, zapDir] = nextSort(zapKey, zapDir, key, 'label');
	}
	$: zapSorted = sortRows(zapped, zapKey, zapDir);
</script>

<!-- Every address names itself as its own, as on every page. The page title names the pill or
	 the section the address opens ("Nostrology - Git on Nostr - Hosting"), and a section with a
	 preview of its own (Zaps) draws it; every other address draws /git's. -->
<SocialMeta
	title={pageTitle(GIT_SLUGS, 'Nostrology - Git on Nostr', data.target)}
	socialTitle={section?.preview?.title ?? 'Git on Nostr, in numbers'}
	description={section?.preview?.description ??
		'Git on Nostr measured from actual events: repositories, pushes, hosting, maintainers and discussion, per NIP-34 (git collaboration).'}
/>

<TransientNote text={$note} />

<div class="space-y-6">
	<h1 class="text-3xl font-bold text-white">Git on Nostr</h1>
	<p class="max-w-3xl text-sm leading-relaxed text-gray-400">
		Git on Nostr puts the coordination layer of a git repository on Nostr, as NIP-34 (git
		collaboration) defines it: each maintainer announces the repository, every push republishes
		its branch and tag tips, and issues, patches and pull requests travel as events. Different
		tools publish these events and keep the code in different places; this page measures what
		the events themselves say.
	</p>

	<!-- Headline numbers frame all five pills. From sm up they ride above the pill bar; on a
		 phone the pill bar comes first (order-first), or it would start 1.4 screens down, below
		 six stacked cards. The DOM keeps cards, then pills, so the pill bar stays right before
		 its panel for a screen reader, and the cards hold nothing focusable, so the keyboard
		 order is the same at every width. On a phone the panel a tap opens is then below the
		 cards, off screen: tap() scrolls to it. -->
	<div class="flex flex-col gap-6">
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0" id="ngit-cards">
			{#each CARDS as c (c.l)}
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-4">
					<div class="text-xs uppercase tracking-wider text-gray-400">{c.l}</div>
					<div class="mt-1 text-3xl font-bold text-white">{c.v}</div>
					{#if c.sub}<div class="mt-1 text-sm text-gray-400">{c.sub}</div>{/if}
				</div>
			{/each}
		</div>

		<PillBar table={GIT_SLUGS} current={$tab} label="Git on Nostr" onPick={tap} class="order-first self-start sm:order-none" />
	</div>

	{#if $tab === 'overview'}
		<div id="panel-overview" class="space-y-4">
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-cumulative">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-lg font-semibold text-white">Cumulative repositories</h2>
					<span class="text-sm text-gray-400">last 12 months</span>
				</div>
				<p class="mb-3 text-sm text-gray-400">Repositories by first-seen day.</p>
				<SmallLine
					series={cumSeries}
					labels={cumWin.labels}
					bucket="day"
					dimBefore={cov.announcements_since}
					wallNote={WALL_NOTE}
					yAxisLabel="repositories"
					heightPx={280}
					fill
					ariaLabel="Cumulative repositories by first-seen day"
				/>
			</div>

			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-new-repos">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-lg font-semibold text-white">New repositories per week</h2>
					<span class="text-sm text-gray-400">by kind of host today</span>
				</div>
				<p class="mb-3 max-w-4xl text-sm text-gray-400">
					Each repository in the week it was first seen, under every kind of host it is on today:
					one on a GRASP server and GitHub counts under both GRASP and Forges, so a week's bars can
					add up to more than its new repositories. No public host counts those with no public
					clone URL. The line is first-time maintainers: maintainers whose first kept announcement
					falls in the week, each counted once, ever.
				</p>
				{#if D.new_repos_weekly && newByHost && newReposSeries.length > 0}
					<StackedBars
						series={newReposSeries}
						line={firstTimeLine}
						labels={newWin.labels}
						bucket="week"
						grouped
						totals={newReposTotals}
						totalLabel="New repositories"
						partialLabel={cov.partial_week}
						partialNote={partialWeekNote}
						yAxisLabel="repositories"
						heightPx={320}
						ariaLabel="New repositories per week by the kinds of host they are on today, and first-time maintainers"
					/>
				{:else}
					<p class="text-sm text-gray-400" data-not-in-snapshot>{D.new_repos_weekly ? NOT_BY_HOST : NOT_IN_SNAPSHOT}</p>
				{/if}
			</div>

			<div class="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-pushes">
					<h2 class="mb-1 text-lg font-semibold text-white">Pushes per week</h2>
					<p class="mb-3 text-sm text-gray-400">
						A push is a published state whose branch or tag tips moved; identical republishes and
						HEAD-only changes do not count.{hashtreeCounted
							? " A hashtree repository's push is read from the announcement its git tool republishes with each branch or tag it pushes publicly; republishes less than two minutes apart count once."
							: ''}
					</p>
					<StackedBars
						series={pushSeries}
						labels={weeks}
						bucket="week"
						partialLabel={cov.partial_week}
						partialNote={partialWeekNote}
						yAxisLabel="pushes"
						heightPx={260}
						ariaLabel="Pushes per ISO week"
					/>
				</div>
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-pushed">
					<h2 class="mb-1 text-lg font-semibold text-white">Who pushed, per week</h2>
					<p class="mb-3 text-sm text-gray-400">
						Distinct repositories with a push, and distinct maintainers pushing, each ISO week.
						{n(s.repos_with_state)} repositories have ever published a state{hashtreeCounted
							? '; a hashtree repository pushes without one'
							: ''}.
					</p>
					<SmallLine
						series={pushedSeries}
						labels={weeks}
						bucket="week"
						partialLabel={cov.partial_week}
						partialNote={partialWeekNote}
						yAxisLabel="per week"
						heightPx={260}
						ariaLabel="Repositories pushed and maintainers pushing per ISO week"
					/>
				</div>
			</div>

			<!-- What is counted: collapsed by default, after the figures, with an address of its own
				 and the icon that copies it (MethodologySection; $lib/methodology): /git/methodology
				 opens this pill with this section expanded, just under the nav. -->
			<MethodologySection bind:open={$methodologyOpen} href={addressOf(GIT_SLUGS, METHODOLOGY)}>
				<p class="mt-2 max-w-4xl text-sm leading-relaxed text-gray-400">
					Observation began on {dayName(cov.announcements_since)} for repository announcements, on
					{dayName(cov.states_since)} for states and GRASP lists and on {dayName(cov.comments_since)}
					for comments. Before that the archive holds only what relays still served when observation
					began, so the weekly charts start no earlier than the week of {dayName(isoMonday(WEEKLY_FROM))}
					(the week holding {dayName(WEEKLY_FROM)}), after all three{cumFades
						? ', and the cumulative chart fades the days before observation of announcements began'
						: ''}.
				</p>
				<div class="mt-4 overflow-x-auto">
					<table class="w-full min-w-[480px] text-left text-sm" aria-label="Sources">
						<thead>
							<tr class="border-b border-gray-700 text-xs uppercase tracking-wider text-gray-400">
								<th class="py-2 pr-3 font-medium">Source</th>
								<th class="py-2 pr-3 font-medium">Used for</th>
								<th class="py-2 font-medium">Observed since</th>
							</tr>
						</thead>
						<tbody>
							{#each SOURCES as src (src.kind)}
								<tr class="border-b border-gray-700/50">
									<td class="py-1.5 pr-3 font-mono text-xs text-gray-200">{src.kind}</td>
									<td class="py-1.5 pr-3 text-gray-400">{src.role}</td>
									<td class="py-1.5 tabular-nums text-gray-400">{src.since ?? 'no date recorded'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<h3 class="mt-5 text-sm font-semibold uppercase tracking-wider text-gray-400">The exclusion ledger</h3>
				<p class="mt-1 text-sm text-gray-400">
					First matching rule wins. The rows are not all in one unit - each says what it counts.
				</p>
				<div class="mt-3 space-y-2" id="ngit-ledger">
					<div class="flex items-baseline gap-3 border-l-2 border-gray-600 pl-3">
						<span class="w-20 shrink-0 text-right font-mono tabular-nums text-gray-200">{n(s.announcements_total)}</span>
						<span class="text-gray-200">
							announcements (one per author and identifier)
						</span>
					</div>
					{#each announcementRows as e, i (i)}
						<LedgerRow row={e} />
					{/each}
					<div class="flex items-baseline gap-3 border-l-2 border-nostr-purple pl-3 pt-1">
						<span class="w-20 shrink-0 text-right font-mono tabular-nums text-white">{n(s.announcements_kept)}</span>
						<span class="text-gray-200">
							announcements kept, forming {n(s.repos)} repositories
							<span class="text-sm text-gray-400">
								(co-maintainers who list each other merge into one repository)
							</span>
						</span>
					</div>
					{#if otherUnitRows.length}
						<p class="pt-2 text-sm text-gray-400">Also left out, in other units:</p>
						{#each otherUnitRows as e, i (i)}
							<LedgerRow row={e} muted />
						{/each}
					{/if}
				</div>
				<p class="mt-3 text-xs text-gray-400" id="ngit-anomalies">
					Impossible timestamps are dropped and never admitted to a series:
					{n(futureDated)} {futureDated === 1 ? 'event' : 'events'} dated after the run instant and
					{n(pastDated)} dated before 2023, when NIP-34 (git collaboration) did not exist yet.
				</p>

				<h3 class="mt-5 text-sm font-semibold uppercase tracking-wider text-gray-400">What these numbers are not</h3>
				<!-- The caveats of the dataset reference, section 8, in its order: all but the Sybil
					 one, which the operator dropped from the page on 2026-10-09. The first names no relay,
					 unlike the reference's: the page names none (see SOURCES). The issue and pull-request
					 one still says the roots are not archived, unlike the reference's (they are since
					 2026-10-09): it stays until the page counts issues and pull requests, like the
					 Collaboration discussion sentence (the operator's choice, 2026-10-09). -->
				<ul class="mt-2 max-w-4xl list-disc space-y-1 pl-5 text-sm text-gray-400" id="ngit-not">
					<li>
						Not an exhaustive count of repositories on Nostr: only of the ones the relays we read served, after the
						ledger. A repository whose events never reached one of them is invisible.
					</li>
					{#if hashtreeCounted}
						<li>
							Not commits: a push is one state publication that moved at least one branch or tag, or one
							hashtree push read from its republished announcements, however many commits it carried.
						</li>
						<li>
							Not every hashtree push: hashtree publishes a push as its own root event, never as a
							kind-30618 (repo-states), so a hashtree repository's push is counted from the announcement
							its git tool republishes with a public push ({n(hashtreePushes)} of the pushes in 30 days).
							Private and link-visible pushes, pushes from Iris Git's web app and a repository's first
							push are not counted, nor is a push whose announcements did not reach us in time; an edit
							that republishes the announcement counts as one.
						</li>
					{:else}
						<li>Not commits: a push is one state publication that moved at least one branch or tag, however many commits it carried.</li>
						<li>
							Not hashtree's pushes: hashtree publishes a push as its own root event, never as a
							kind-30618 (repo-states), so none of them is counted{hashtreeScope}.
						</li>
					{/if}
					<li>Not verified projects: a kept repository is an announcement that survived the ledger.</li>
					<li>
						Not issue or pull-request counts: those events are not archived; discussion is counted
						by root kind network-wide and attributed to a repository only when the comment names one
						(see Collaboration).
					</li>
					{#if irisCounted}
						<li>
							Not net of every unstar: a kind-7 (reactions) star is withdrawn by a deletion request, and those
							are not read for reactions; an Iris Git star is withdrawn by its key's later "-", which is.
						</li>
					{:else}
						<li>Not net stars: an unstar is a deletion request, and those are not read for reactions.</li>
					{/if}
					<li>
						Not verified payments: a counted zap receipt is signed by a verified LNURL provider key,
						which makes it plausible, not proof that the invoice was paid; nothing checks the receipt
						against the provider or the invoice.
					</li>
					<li>
						Not case-folded: identifiers that differ only by letter case or outer whitespace are
						separate repositories, as NIP-01 (protocol basics) compares identifiers exactly.
					</li>
					<li>
						Not activity before {dayName(cov.states_since)}: a state from before observation began is
						not a push, and its date is only a lower bound on the last change.
					</li>
				</ul>
			</MethodologySection>
		</div>
	{/if}

	{#if $tab === 'repositories'}
		<div id="panel-repositories" class="space-y-4">
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-repos-active">
				<h2 class="text-lg font-semibold text-white">Most active repositories</h2>
				<p class="mb-3 mt-1 text-sm text-gray-400">
					{upperFirst(cutOf(D.repos_active.length, s.repos_pushed_90d, REPOS))} pushed in the 90 days
					to {dayName(D.as_of_day)}, by pushes. {sortNote(D.repos_active.length, s.repos_pushed_90d)}
				</p>
				<RepoTable rows={D.repos_active} initialKey="pushes_90d" caption="Most active repositories, 90 days" />
			</div>

			<div class="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-topics">
					<h2 class="text-lg font-semibold text-white">Topics</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						The <code class="text-gray-300">t</code> tags on announcements:
						{cutOf(topicRows.length, null, TOPICS)} by repositories. Tool markers and date tags are
						left out.
					</p>
					<div class="[overflow-wrap:anywhere]">
						<HBar rows={topicRows} subLabel="" valueLabel="repositories" color="#c084fc" format={n} />
					</div>
				</div>
				<!-- Half a row beside Topics, so its two bucket lists stack instead of sharing one. -->
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-anatomy">
					<h2 class="text-lg font-semibold text-white">Anatomy</h2>
					<p class="mt-1 text-sm text-gray-400">
						Over the {n(s.repos_with_state)} repositories with a state, read from each one's newest
						state.
					</p>
					<div class="mt-4 space-y-6">
						<div>
							<h3 class="mb-2 text-sm font-semibold text-gray-300">Branches per repository</h3>
							<HBar rows={bucketRows(D.branches_per_repo)} subLabel="" valueLabel="repositories" color={GREEN} format={n} />
						</div>
						<div>
							<h3 class="mb-2 text-sm font-semibold text-gray-300">Tags per repository</h3>
							<HBar rows={bucketRows(D.tags_per_repo)} subLabel="" valueLabel="repositories" color={GREEN} format={n} />
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if $tab === 'hosting'}
		<div id="panel-hosting" class="space-y-4">
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-hosting-classes">
				<h2 class="text-lg font-semibold text-white">Where the code lives</h2>
				<p class="mt-1 max-w-4xl text-sm text-gray-400">
					A GRASP server is a git host that is also a Nostr relay. A hashtree repository is a whole
					git repository, branches and tags included, kept as one content-addressed tree on Blossom
					file servers and peers.
				</p>
				<p class="mb-3 mt-2 max-w-4xl text-sm text-gray-400">
					Each repository is in exactly one class judged over its public clone URLs.
				</p>
				<div class="grid items-center gap-6 lg:grid-cols-[minmax(0,18rem)_1fr] [&>*]:min-w-0">
					<Donut
						rows={hostingRows}
						colors={hostingColors}
						heightPx={240}
						centerTitle={pct(graspOrHashtreeShare)}
						centerSub="GRASP or hashtree"
						unitLabel="repositories"
						format={n}
					/>
					<dl class="space-y-2">
						{#each D.hosting as h, i (i)}
							<div class="flex items-start gap-3 text-sm">
								<span class="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style="background: {hostingColors[i]}"></span>
								<div class="min-w-0 flex-1">
									<dt class="flex justify-between gap-3">
										<span class="text-gray-200">{labelFor(HOSTING_CLASS_LABEL, h.k)}</span>
										<span class="flex items-baseline gap-1 tabular-nums">
											<span class="text-gray-200">{n(h.v)}</span>
											<span class="w-10 text-right text-xs text-gray-400" data-share>{classShare(h.v)}</span>
										</span>
									</dt>
									<dd class="text-xs text-gray-400">{labelFor(HOSTING_CLASS_DEF, h.k)}</dd>
								</div>
							</div>
						{/each}
					</dl>
				</div>
			</div>

			<!-- Three rows of two. Each pair is one grid row, so its two cards share one height:
				 Clone hosts beside GRASP servers, the two per-repository bucket lists, then the
				 relays and the web pages. -->
			<div class="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
				<!-- A flex column, so HBar's fill can spread its 20 rows down to where the GRASP
					 servers table beside it ends: the grid row gives both cards the taller one's
					 height, and table rows are taller than bars. -->
				<div class="flex flex-col rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-clone-hosts">
					<h2 class="text-lg font-semibold text-white">Clone hosts</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						{upperFirst(cutOf(cloneHostRows.length, null, HOSTS))} across all clone URLs, by
						repositories; a repository counts once per host.
					</p>
					{#if cloneHostKinds.length}
						<!-- Each key a square, as for the bars of every chart on the page. -->
						<ul class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="chart-legend" aria-label="Kinds of host">
							{#each cloneHostKinds as k, i (i)}
								<li class="flex items-center gap-2 text-gray-300">
									<span class="inline-block h-3 w-3 shrink-0 rounded-sm" style="background-color: {hostKindColor(k)}" data-swatch="bar"></span>
									{labelFor(CLONE_HOST_KIND_LABEL, k)}
								</li>
							{/each}
						</ul>
					{/if}
					<div class="flex flex-1 flex-col [overflow-wrap:anywhere]">
						<HBar
							rows={cloneHostRows}
							subLabel=""
							valueLabel="repositories"
							color={NEUTRAL_SERIES}
							labelWidth="minmax(9rem,15rem)"
							format={n}
							fill
						/>
					</div>
				</div>
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-grasp-servers">
					<h2 class="text-lg font-semibold text-white">GRASP servers</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						{upperFirst(cutOf(D.grasp_servers.length, s.grasp_servers, SERVERS))} by repositories
						with a GRASP-shaped (npub-path) clone URL on the server, and how many users name each in
						their kind-10317 (grasp-server-lists).
						{sortNote(D.grasp_servers.length, s.grasp_servers)} Clone hosts counts any clone URL on
						a host, so its figure for a GRASP server can be higher.
					</p>
					<div class="overflow-x-auto">
						<table class="w-full min-w-[360px] text-left text-sm" aria-label="GRASP servers">
							<thead>
								<tr class="border-b border-gray-700 text-xs uppercase tracking-wider text-gray-400">
									<SortTh label="Server" key="host" sortKey={graspKey} sortDir={graspDir} onSort={sortGrasp} />
									<SortTh label="Repositories" key="repos" sortKey={graspKey} sortDir={graspDir} right onSort={sortGrasp} />
									<SortTh label="Users listing" key="users" sortKey={graspKey} sortDir={graspDir} right onSort={sortGrasp} />
								</tr>
							</thead>
							<tbody>
								{#each graspSorted as g, i (i)}
									<tr class="border-b border-gray-700/50">
										<td class="py-1.5 pr-3 text-gray-200"><bdi>{labelText(g.host)}</bdi></td>
										<td class="py-1.5 pr-3 text-right tabular-nums {sortInk(graspKey, 'repos')}">{n(g.repos)}</td>
										<td class="py-1.5 pr-3 text-right tabular-nums {sortInk(graspKey, 'users')}">{n(g.users)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>

			<div class="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-relays-per-repo">
					<h2 class="text-lg font-semibold text-white">Relays per repository</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						Over all {n(s.repos)} repositories, by how many distinct relays their
						<code class="text-gray-300">relays</code> tag names.
					</p>
					<HBar rows={bucketRows(D.relays_per_repo)} subLabel="" valueLabel="repositories" color={RELAYS_PER_REPO_COLOR} format={n} />
				</div>
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-grasp-per-repo">
					<h2 class="text-lg font-semibold text-white">GRASP servers per repository</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						Over the {n(s.grasp_repos)} GRASP-hosted repositories; ngit.dev recommends listing
						three to five.
					</p>
					<HBar rows={bucketRows(D.grasp_per_repo)} subLabel="" valueLabel="repositories" color={GRASP_COLOR} format={n} />
				</div>
			</div>

			<div class="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-relays">
					<h2 class="text-lg font-semibold text-white">Collaboration relays</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						The relays repositories ask collaborators to use (their <code class="text-gray-300">relays</code>
						tag): {cutOf(relayRows.length, null, RELAYS)} by repositories naming each.
					</p>
					<div class="[overflow-wrap:anywhere]">
						<HBar
							rows={relayRows}
							subLabel=""
							valueLabel="repositories"
							color={NEUTRAL_SERIES}
							labelWidth="minmax(9rem,15rem)"
							format={n}
						/>
					</div>
				</div>
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-web-hosts">
					<h2 class="text-lg font-semibold text-white">Web pages</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						Hosts of the announced web links: {cutOf(webHostRows.length, null, HOSTS)} by repositories.
					</p>
					<div class="[overflow-wrap:anywhere]">
						<HBar
							rows={webHostRows}
							subLabel=""
							valueLabel="repositories"
							color={NEUTRAL_SERIES}
							labelWidth="minmax(9rem,15rem)"
							format={n}
						/>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if $tab === 'maintainers'}
		<div id="panel-maintainers" class="space-y-4">
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-maintainers">
				<h2 class="text-lg font-semibold text-white">Most active maintainers</h2>
				<p class="mb-3 mt-1 text-sm text-gray-400">
					{upperFirst(cutOf(D.maintainers_top.length, s.maintainers, MAINTAINERS))} by pushes in
					the last 90 days, then by repositories they maintain.
					{sortNote(D.maintainers_top.length, s.maintainers)} A push counts only for the maintainer
					who published it, never for their co-maintainers. A repository with several maintainers
					counts once for each of them. Names are their kind-0 (profile-metadata) display names
					where one is available.
				</p>
				<div class="overflow-x-auto">
					<table class="w-full min-w-[520px] text-left text-sm" aria-label="Most active maintainers">
						<thead>
							<tr class="border-b border-gray-700 text-xs uppercase tracking-wider text-gray-400">
								<SortTh label="Maintainer" key="who" sortKey={maintKey} sortDir={maintDir} onSort={sortMaint} />
								<SortTh label="Repositories" key="repos" sortKey={maintKey} sortDir={maintDir} right onSort={sortMaint} />
								<SortTh label="Pushes 90 d" key="pushes_90d" sortKey={maintKey} sortDir={maintDir} right onSort={sortMaint} />
								<SortTh label="Last push" key="last_push" sortKey={maintKey} sortDir={maintDir} onSort={sortMaint} />
							</tr>
						</thead>
						<tbody>
							{#each maintSorted as m, i (i)}
								<tr class="border-b border-gray-700/50">
									<td class="max-w-[16rem] truncate py-1.5 pr-3" title={m.pubkey}>
										{#if m.href}
											<a href={m.href} target="_blank" rel="noopener noreferrer" class="text-gray-100 underline decoration-gray-600 underline-offset-2 transition-colors hover:text-nostr-gold hover:decoration-nostr-gold"><bdi>{m.who}</bdi></a>
										{:else}
											<span class="text-gray-100"><bdi>{m.who}</bdi></span>
										{/if}
										<!-- The sorted column again under the name: on a phone it is off screen
											 behind the table's scroll. It follows the reader's sort, as the bright
											 ink does (RepoTable does the same); none for a sort by name. -->
										{#if maintLine(m, maintKey)}
											<div class="sm:hidden text-xs text-gray-400 tabular-nums">{maintLine(m, maintKey)}</div>
										{/if}
									</td>
									<td class="py-1.5 pr-3 text-right tabular-nums {sortInk(maintKey, 'repos')}">{n(m.repos)}</td>
									<td class="py-1.5 pr-3 text-right tabular-nums {sortInk(maintKey, 'pushes_90d')}">{n(m.pushes_90d)}</td>
									<td class="py-1.5 pr-3 tabular-nums {sortInk(maintKey, 'last_push')}">{m.last_push ?? '-'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-grasp-lists">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-lg font-semibold text-white">Users with a GRASP server list</h2>
					<span class="text-sm text-gray-400">kind-10317 (grasp-server-lists)</span>
				</div>
				<p class="mb-3 max-w-4xl text-sm text-gray-400">
					{n(D.grasp_lists.users)} users publish a list of the GRASP servers they want their
					repositories on, while {n(s.grasp_repos)} repositories are GRASP-hosted: a repository names
					its servers itself, so most maintainers never publish a list. Bars are new users, by the
					week their list was first seen; the line is the running total.
				</p>
				{#if D.grasp_lists.per_week}
					<StackedBars
						series={graspListSeries}
						line={graspTotalLine}
						labels={graspWin.labels}
						bucket="week"
						partialLabel={cov.partial_week}
						partialNote={partialWeekNote}
						yAxisLabel="new users"
						heightPx={220}
						ariaLabel="New users with a GRASP server list per week, and the running total"
					/>
				{:else}
					<p class="text-sm text-gray-400" data-not-in-snapshot>{NOT_IN_SNAPSHOT}</p>
				{/if}
				<div class="mt-5 max-w-xl">
					<h3 class="mb-2 text-sm font-semibold text-gray-300">Servers per list</h3>
					<p class="mb-2 text-sm text-gray-400">
						How many servers users' lists name.
					</p>
					<HBar
						rows={bucketRows(D.grasp_lists.length)}
						subLabel=""
						valueLabel="users"
						color={GRASP_COLOR}
						format={n}
						total={D.grasp_lists.users}
						formatShare={(x) => pct(x, 0)}
					/>
				</div>
			</div>
		</div>
	{/if}

	{#if $tab === 'collaboration'}
		<div id="panel-collaboration" class="space-y-4">
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-discussion">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-lg font-semibold text-white">Discussion per week</h2>
					<span class="text-sm text-gray-400">counted comments, by the kind of their root</span>
				</div>
				<!-- "not archived yet" is untrue since 2026-10-09 and stays until the page counts issues
					 and pull requests, like What is counted's caveat (the operator's choice, 2026-10-09). -->
				<p class="mb-3 max-w-4xl text-sm leading-relaxed text-gray-400">
					kind-1111 (comments) on issues, pull requests, patches and repositories. The issues,
					patches and pull requests themselves - kind-1621 (git-issues), kind-1617 (git-patches),
					kind-1618 (git-pull-requests) and kind-1619 (git-pr-updates) - are not
					archived yet, so there are no issue or pull-request counts here: discussion is counted
					network-wide by the kind of its root, and attributed to a repository only when the comment
					names one - {pct(s.comments_attributable_share)} of them do.
				</p>
				{#if D.comments_weekly}
					<StackedBars
						series={commentSeries}
						labels={commentWin.labels}
						bucket="week"
						partialLabel={cov.partial_week}
						partialNote={partialWeekNote}
						yAxisLabel="comments"
						heightPx={300}
						ariaLabel="Counted comments per week by root kind"
					/>
				{:else}
					<p class="text-sm text-gray-400" data-not-in-snapshot>{NOT_IN_SNAPSHOT}</p>
				{/if}
				<h3 class="mb-2 mt-5 text-sm font-semibold text-white">Participants and threads</h3>
				<p class="mb-2 text-sm text-gray-400">
					{n(s.comment_participants)} authors have commented in {n(s.comment_threads)} threads in all,
					including what relays still served from before observation began on
					{dayName(cov.comments_since)}; per week, each on its own axis:
				</p>
				{#if D.comments_weekly}
					<SmallLine
						series={authorsSeries}
						rightSeries={threadsLine}
						labels={commentWin.labels}
						bucket="week"
						partialLabel={cov.partial_week}
						partialNote={partialWeekNote}
						yAxisLabel="authors"
						heightPx={220}
						ariaLabel="Comment authors and threads per week, each on its own axis"
					/>
				{:else}
					<p class="text-sm text-gray-400" data-not-in-snapshot>{NOT_IN_SNAPSHOT}</p>
				{/if}
				<details class="mt-5">
					<summary class="cursor-pointer select-none text-gray-400 marker:text-gray-400">
						<h3 class="inline text-sm font-semibold uppercase tracking-wider">Comments left out</h3>
					</summary>
					<div class="mt-2 space-y-2" id="ngit-comment-ledger">
						{#each commentLedger as e, i (i)}
							<LedgerRow row={e} showUnit={false} />
						{:else}
							<p class="text-sm text-gray-400">None this run.</p>
						{/each}
						<div class="flex items-baseline gap-3 border-l-2 border-nostr-purple pl-3 pt-1">
							<span class="w-20 shrink-0 text-right font-mono tabular-nums text-white">{n(s.comments_total)}</span>
							<span class="text-gray-200">comments counted</span>
						</div>
					</div>
				</details>
			</div>

			<!-- Since 2026-10-18 (the operator's ask) neither heading carries a total and no cut
				 names its population: each table's cut names only how many rows it holds, though
				 the population still decides whether the sort note shows. The Zaps card keeps its
				 receipts sentence, its one line of figures. Its bolt is the glyph the site's
				 spinners use, hidden from screen readers so the heading's name stays "Zaps". Later
				 that day the operator had Zaps ranked by receipts, and then had each cut name no
				 measure at all ("The top 20 repositories."): a reader can re-sort the table, and a
				 screenshot of it must still read true. For the same reason the bright ink follows
				 the column sorted at that moment, in every sortable table on the page (sortInk). -->
			<div class="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-stars" data-lists={data.listsFrom ?? 'document'}>
					<h2 class="text-lg font-semibold text-white">Stars</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						{#if irisCounted}
							A star is a kind-7 (reactions) with "+" or empty content on a repository announcement, or
							Iris Git's kind-17 (external-content-reactions) on a repository announcement when that key's
							latest one on it is "+" or empty. Each key counts once per repository. An Iris Git star is
							net of unstars (a later "-"); a kind-7 (reactions) star is not, as its unstars are deletion
							requests, which this page does not currently read for reactions.
						{:else}
							A star is a kind-7 (reactions) with "+" or empty content on a repository announcement,
							counted once per reacting key and repository. It is not net of unstars, which are
							deletion requests this page does not read.
						{/if}
					</p>
					{#if !starsRead}
						<p class="text-sm text-gray-400" data-empty-input>
							{irisCounted
								? 'No kind-7 (reactions) or kind-17 (external-content-reactions) were read in this run - an empty input, not a measured zero.'
								: 'No kind-7 (reactions) were read in this run - an empty input, not a measured zero.'}
						</p>
					{:else}
						{#if showLeaderboard(D.repos_starred)}
							<p class="mb-2 text-sm text-gray-400">
								{upperFirst(cutOf(D.repos_starred.length, null, REPOS))}.
								{sortNote(D.repos_starred.length, s.stars_repos)}
							</p>
							<table class="w-full text-left text-sm" aria-label="Most-starred repositories">
								<thead>
									<tr class="border-b border-gray-700 text-xs uppercase tracking-wider text-gray-400">
										<SortTh label="Repository" key="label" sortKey={starKey} sortDir={starDir} onSort={sortStars} />
										<SortTh label="Stars" key="stars" sortKey={starKey} sortDir={starDir} right onSort={sortStars} />
									</tr>
								</thead>
								<tbody>
									{#each starSorted as r, i (i)}
										<tr class="border-b border-gray-700/50">
											<td class="py-1.5 pr-3" title="{r.pubkey}:{r.d}">
												<RepoLink pubkey={r.pubkey} d={r.d} name={r.name} cls={r.cls} wrapAnywhere />
											</td>
											<td class="py-1.5 pr-3 text-right tabular-nums {sortInk(starKey, 'stars')}">{n(r.stars)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{:else}
							<p class="text-sm text-gray-400" data-leaderboard-hidden>
								{D.repos_starred.length === 0
									? 'No repository has a counted star in this snapshot.'
									: `Too few starred repositories to rank (${D.repos_starred.length}).`}
							</p>
						{/if}
					{/if}
				</div>
				<div class="relative rounded-xl border border-gray-700 bg-gray-800 p-5" id="ngit-zaps" data-lists={data.listsFrom ?? 'document'}>
					<h2 class="text-lg font-semibold text-white">Zaps <span aria-hidden="true">⚡</span></h2>
					<SectionLink
						href={addressOf(GIT_SLUGS, 'zaps')}
						title={GIT_SLUGS.sections.zaps.title}
						phoneShown={phoneLink === 'zaps'}
					/>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						kind-9735 (zap-receipts) naming a repository. A receipt counts only when it is signed by
						a verified LNURL provider key, pays a maintainer of the repository, and its zap request's
						amount, where the request states one, equals the invoice amount.
					</p>
					{#if !zapsRead}
						<p class="text-sm text-gray-400" data-empty-input>
							No kind-9735 (zap-receipts) were read in this run - an empty input, not a measured zero.
						</p>
					{:else}
						<p class="mb-3 text-sm text-gray-400">
							{n(s.zap_receipts)} receipts to {n(s.zaps_repos)} repositories from {n(s.zappers)} zappers.
						</p>
						{#if showLeaderboard(D.repos_zapped)}
							<p class="mb-2 text-sm text-gray-400">
								{upperFirst(cutOf(D.repos_zapped.length, null, REPOS))}.
								{sortNote(D.repos_zapped.length, s.zaps_repos)}
							</p>
							<table class="w-full text-left text-sm" aria-label="Most-zapped repositories">
								<thead>
									<tr class="border-b border-gray-700 text-xs uppercase tracking-wider text-gray-400">
										<SortTh label="Repository" key="label" sortKey={zapKey} sortDir={zapDir} onSort={sortZaps} />
										<SortTh label="Receipts" key="receipts" sortKey={zapKey} sortDir={zapDir} right onSort={sortZaps} />
										<SortTh label="Sats" key="msats" sortKey={zapKey} sortDir={zapDir} right onSort={sortZaps} />
									</tr>
								</thead>
								<tbody>
									{#each zapSorted as r, i (i)}
										<tr class="border-b border-gray-700/50">
											<td class="py-1.5 pr-3" title="{r.pubkey}:{r.d}">
												<RepoLink pubkey={r.pubkey} d={r.d} name={r.name} cls={r.cls} wrapAnywhere />
											</td>
											<td class="py-1.5 pr-3 text-right tabular-nums {sortInk(zapKey, 'receipts')}">{n(r.receipts)}</td>
											<td class="py-1.5 pr-3 text-right tabular-nums {sortInk(zapKey, 'msats')}">{n(satsFromMsats(r.msats))}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{:else}
							<p class="text-sm text-gray-400" data-leaderboard-hidden>
								{D.repos_zapped.length === 0
									? 'No repository has a counted zap in this snapshot.'
									: `Too few zapped repositories to rank (${D.repos_zapped.length}).`}
							</p>
						{/if}
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- The snapshot's dates are here only since 2026-10-18 (the operator's choice). From
		 2026-09-26 (web review 4) a line under the title said the same, so that a page a failed
		 nightly run leaves on the previous row looked stale where it is read. Every date reads
		 "Oct 17, 2026" since then too (the operator's choice; they were ISO), the instant its
		 UTC timestamp. -->
	<p class="border-t border-gray-700 pt-4 text-xs text-gray-400" id="ngit-footer">
		Every window ends on <time datetime={D.as_of_day}>{dayName(D.as_of_day)}</time>, the last complete
		UTC day before this snapshot was generated at <time datetime={D.generated_utc}>{D.generated_utc}</time>,
		and every count is a lower bound{hashtreeCounted
			? ', but for the hashtree edits What is counted names'
			: ''}. Announcements have been observed since
		<time datetime={cov.announcements_since}>{dayName(cov.announcements_since)}</time>, states and GRASP
		lists since <time datetime={cov.states_since}>{dayName(cov.states_since)}</time>, and comments since
		<time datetime={cov.comments_since}>{dayName(cov.comments_since)}</time>.
	</p>
</div>
