// Where the analytics-off badge sits - and the one browser that needs it nudged.
//
// The badge is `position: fixed`, 12px above the bottom of the layout viewport. In Chrome
// on iOS that edge is the top of Chrome's opaque bottom toolbar; on a desktop, and in
// landscape Safari, it is the bottom of the window. 12px reads right in all of them.
//
// iPHONE SAFARI 26+, PORTRAIT, IS DIFFERENT. Its floating tab bar RESERVES more than it
// draws: WebKit deliberately puts `bottom: 0` above the browser controls ("we chose to
// have bottom:0 be above the controls", Simon Fraser, bugs.webkit.org/show_bug.cgi?id=297779
// comment 23), and that edge is ~16 CSS px above the visible pill. Measured 2026-09-24 from
// screenshots (a 375pt-wide iPhone, Safari 26.6.2): the bubble's bottom sat 28px above the
// URL pill, against the 12px above Chrome's toolbar that reads right.
//
// AND SAFARI CLIPS A FIXED ELEMENT AT THAT EDGE. Nothing of it below `bottom: 0` is drawn,
// though the page itself shows through the band. The first nudge went 16px, to -4px, for
// Chrome's exact geometry, and lost the bubble's lowest 4px: on a native 3x screenshot it
// stopped 12 device px short of its 22px height, with no bottom border, the clip falling
// exactly on the bottom: 0 edge. So the nudge is 12px, to `bottom: 0` and no lower, which
// by that capture draws the whole bubble 16px above the pill - the closest Safari allows.
// Expected, not yet captured at 0; nor is the smaller bar Safari shows after a scroll.
//
// WHY THE USER AGENT: no CSS or JS signal exposes the reserved band. Under Safari's bar
// env(safe-area-inset-bottom) is 0 (WebKit reports max(0, safe area - obscured inset)), and
// innerHeight, visualViewport and the dvh/svh/lvh units all exclude the band already. The
// cost of a wrong answer is a private dot 12px out of place, so matching Safari's own UA
// string is proportionate.
//
// SAFARI'S OWN UA, AND NOTHING ELSE. Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS), the
// Google app (GSA) and DuckDuckGo (`DuckDuckGo/7` before Safari/, or a trailing `Ddg/`)
// add or swap a token and draw their own toolbars, so the pattern is anchored at both
// ends. The OS token is FROZEN (iOS 26 still sends `iPhone OS 18_7`), so the version comes
// from `Version/`. iPadOS sends a Mac UA by default and has no floating bar.
//
// Not detectable, and accepted: anything that sends Safari's UA byte for byte behind other
// toolbars - DuckDuckGo's default mode, and SFSafariViewController (a link opened inside
// another app) - and Safari's other tab layouts (Settings -> Apps -> Safari), which may
// reserve no band: there `bottom: 0` would put the bubble flush on the bar (Bottom layout)
// or on the screen's lower edge (Top). Unmeasured; the nudge assumes Compact, the default.

const IPHONE_SAFARI =
	/^Mozilla\/5\.0 \(iPhone; CPU iPhone OS [\d_]+ like Mac OS X\) AppleWebKit\/[\d.]+ \(KHTML, like Gecko\) Version\/(\d+)[\d.]* Mobile\/\w+ Safari\/[\d.]+$/;

/** True for iPhone Safari 26 or later: the browser whose floating tab bar needs the badge nudged. */
export function hasFloatingTabBar(userAgent: string): boolean {
	const m = IPHONE_SAFARI.exec(userAgent);
	return m !== null && Number(m[1]) >= 26;
}
