// Which browsers get the analytics-off badge nudged down (see badge.ts). The first four
// strings are real browsers' User-Agents, copied from the site's access log on 2026-09-24;
// the rest are the look-alikes the anchored pattern exists to reject.

import { describe, expect, it } from 'vitest';
import { hasFloatingTabBar } from './badge';

const IPHONE_SAFARI_26 =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 26_7_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.8010.24 Mobile/15E148 Safari/604.1';
const MAC_SAFARI =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15';
const MAC_CHROME =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

describe('hasFloatingTabBar', () => {
	it('is true for iPhone Safari (frozen iPhone OS 18_7 token, Version/26)', () => {
		expect(hasFloatingTabBar(IPHONE_SAFARI_26)).toBe(true);
	});

	it.each([
		['iPhone Chrome', IPHONE_CHROME],
		['Mac Safari', MAC_SAFARI],
		['Mac Chrome', MAC_CHROME]
	])('is false for %s', (_name, ua) => {
		expect(hasFloatingTabBar(ua)).toBe(false);
	});

	it('is true for a later Safari major too', () => {
		expect(hasFloatingTabBar(IPHONE_SAFARI_26.replace('Version/26.6.2', 'Version/27.0'))).toBe(true);
		expect(hasFloatingTabBar(IPHONE_SAFARI_26.replace('Version/26.6.2', 'Version/26'))).toBe(true);
	});

	it('is false for Safari 18, whose bottom bar was docked, not floating', () => {
		expect(hasFloatingTabBar(IPHONE_SAFARI_26.replace('Version/26.6.2', 'Version/18.6'))).toBe(false);
	});

	it.each([
		[
			'Edge (EdgiOS between Version and Mobile)',
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 EdgiOS/140.0.3485.94 Mobile/15E148 Safari/605.1.15'
		],
		[
			'Firefox (FxiOS)',
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/142.0 Mobile/15E148 Safari/605.1.15'
		],
		[
			'the Google app (GSA)',
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/383.0.797833943 Mobile/15E148 Safari/604.1'
		],
		// DuckDuckGo's two token-adding modes, from duckduckgo/apple-browsers
		// iOS/Core/UserAgentManaging.swift: ddgFixedLogic inserts before `Safari/`, .brand appends.
		['DuckDuckGo (DuckDuckGo/7 before Safari/)', IPHONE_SAFARI_26.replace(' Safari/', ' DuckDuckGo/7 Safari/')],
		['DuckDuckGo (a trailing Ddg token)', `${IPHONE_SAFARI_26} Ddg/7`],
		['a UA with anything before Mozilla/5.0', `SomeApp/1.0 ${IPHONE_SAFARI_26}`],
		[
			'an in-app web view (no Version/Safari tokens)',
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
		],
		['an iPad asking for the mobile site', IPHONE_SAFARI_26.replace('(iPhone; CPU iPhone OS', '(iPad; CPU OS')],
		['an empty string', '']
	])('is false for %s', (_name, ua) => {
		expect(hasFloatingTabBar(ua)).toBe(false);
	});
});
