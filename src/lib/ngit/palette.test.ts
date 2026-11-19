import { describe, expect, it } from 'vitest';

import { CLONE_HOST_KIND_LABEL, HOST_KIND_LABEL, HOST_KIND_ORDER, HOSTING_CLASS_LABEL } from './format';
import {
	AMBER,
	BLUE,
	GRASP_COLOR,
	GREEN,
	HOST_KIND_COLOR,
	HOSTING_CLASS_COLOR,
	hostingColor,
	hostKindColor,
	NEUTRAL_SERIES,
	OTHERS_COLOR,
	PINK,
	PURPLE,
	RELAYS_PER_REPO_COLOR,
	TEAL
} from './palette';

/**
 * The hosting colours are a measured, fixed assignment: changing one is a palette change
 * that needs the validator run again (the command is in palette.ts), not a refactor. This
 * fails first, so that happens.
 */
describe('hosting class colours', () => {
	it('keep the assignment measured, in the donut order (the document precedence)', () => {
		expect(Object.entries(HOSTING_CLASS_COLOR)).toEqual([
			['grasp_only', PURPLE],
			['grasp_mixed', BLUE],
			['hashtree', PINK],
			['forge_only', AMBER],
			['other_hosts', GREEN],
			['none', OTHERS_COLOR]
		]);
		// hashtree's teal until 2026-10-11, Delta E 5.2 from the self-hosted green with normal vision:
		// the two could not be told apart in the class list or in Clone hosts
		expect(Object.values(HOSTING_CLASS_COLOR)).not.toContain(TEAL);
	});

	it("swap GRASP + other hosts' and Forges only's colours, the operator's choice", () => {
		// 2026-10-12: they were amber and blue
		expect([HOSTING_CLASS_COLOR.grasp_mixed, HOSTING_CLASS_COLOR.forge_only]).toEqual([BLUE, AMBER]);
		expect(hostingColor('grasp_mixed')).toBe(BLUE);
		expect(hostingColor('forge_only')).toBe(AMBER);
	});

	it('colour every class the page names, each differently', () => {
		expect(Object.keys(HOSTING_CLASS_COLOR).sort()).toEqual(Object.keys(HOSTING_CLASS_LABEL).sort());
		expect(new Set(Object.values(HOSTING_CLASS_COLOR)).size).toBe(6);
	});

	it('go by the class key, with the slate for a class the page does not know yet', () => {
		expect(hostingColor('grasp_only')).toBe(PURPLE);
		expect(hostingColor('brand_new_class')).toBe(OTHERS_COLOR);
		expect(hostingColor('toString')).toBe(OTHERS_COLOR); // not fooled by inherited properties
		expect(GRASP_COLOR).toBe(HOSTING_CLASS_COLOR.grasp_only);
	});

	it('leave the neutral series colour to what is no class at all', () => {
		expect(Object.values(HOSTING_CLASS_COLOR)).not.toContain(NEUTRAL_SERIES);
	});

	it("colour each kind of host with the donut's colour for its kind, one colour per kind on the whole page", () => {
		// each kind takes the colour of the donut's class of that kind, in the page's order of the
		// kinds; the blue of GRASP + other hosts is no kind of host
		expect(Object.entries(HOST_KIND_COLOR)).toEqual([
			['grasp', HOSTING_CLASS_COLOR.grasp_only],
			['hashtree', HOSTING_CLASS_COLOR.hashtree],
			['self_hosted', HOSTING_CLASS_COLOR.other_hosts],
			['forge', HOSTING_CLASS_COLOR.forge_only],
			['none', HOSTING_CLASS_COLOR.none]
		]);
		expect(Object.values(HOST_KIND_COLOR)).toEqual([PURPLE, PINK, GREEN, AMBER, OTHERS_COLOR]);
		expect(Object.values(HOST_KIND_COLOR)).not.toContain(HOSTING_CLASS_COLOR.grasp_mixed);
		expect(Object.values(HOST_KIND_COLOR)).not.toContain(BLUE);
		// every kind of host the page words has a colour, each a different one, keyed in the
		// order the page draws them
		expect(Object.keys(HOST_KIND_COLOR)).toEqual([...HOST_KIND_ORDER]);
		expect(Object.keys(HOST_KIND_COLOR)).toEqual(Object.keys(HOST_KIND_LABEL));
		expect(Object.keys(HOST_KIND_COLOR)).toEqual(Object.keys(CLONE_HOST_KIND_LABEL));
		expect(new Set(Object.values(HOST_KIND_COLOR)).size).toBe(5);
		expect(GRASP_COLOR).toBe(HOST_KIND_COLOR.grasp);
	});

	it('go by the kind key, with the slate for a kind the page does not know yet', () => {
		expect(hostKindColor('forge')).toBe(AMBER);
		expect(hostKindColor('hashtree')).toBe(PINK);
		expect(hostKindColor('self_hosted')).toBe(GREEN);
		expect(hostKindColor('brand_new_kind')).toBe(OTHERS_COLOR);
		expect(hostKindColor('toString')).toBe(OTHERS_COLOR);
	});

	it("give Relays per repository blue, the operator's choice, which stayed when Forges only went amber", () => {
		// 2026-10-08: "the same color for bars as is currently used for Forges only", then blue;
		// the swap of 2026-10-12 named Clone hosts as its only other change
		expect(RELAYS_PER_REPO_COLOR).toBe(BLUE);
		expect(RELAYS_PER_REPO_COLOR).not.toBe(HOSTING_CLASS_COLOR.forge_only);
	});
});
