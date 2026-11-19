import { describe, expect, it } from 'vitest';

import { bubbles, type BubbleSpec, type MapPoint } from './bubbles';

// The two maps of /marketplaces, as +page.svelte configures them.
const GEOGRAPHY: BubbleSpec = {
	weight: 'listings',
	weightLabel: 'listings',
	secondary: 'sellers',
	secondaryLabel: 'sellers',
	color: '#a78bfa'
};
const SHIPPING: BubbleSpec = {
	weight: 'sellers',
	weightLabel: 'sellers ship here',
	secondary: 'options',
	secondaryLabel: 'shipping options',
	color: '#34d399'
};

const US: MapPoint = { lat: 39.5, lon: -98.35, name: 'United States', prec: 'country', listings: 400, sellers: 136 };
const ES: MapPoint = { lat: 40.2, lon: -3.6, name: 'Spain', prec: 'country', listings: 100, sellers: 10 };
const LISBON: MapPoint = { lat: 38.72, lon: -9.14, name: 'Lisbon', prec: 'city', listings: 4, sellers: 1 };

describe('bubbles', () => {
	it('sizes by the square root of the weight, so area tracks the count', () => {
		const [us, es] = bubbles([US, ES], GEOGRAPHY);
		expect(us.options.radius).toBe(31); // the heaviest point: 5 + 26
		expect(es.options.radius).toBe(5 + 26 * Math.sqrt(100 / 400)); // 18: a quarter of the count, half the radius
	});

	it('draws nothing for a point whose weight is zero, missing or not a number', () => {
		const points: MapPoint[] = [
			US,
			{ ...ES, listings: 0 },
			{ ...ES, name: 'no field', listings: undefined },
			{ ...ES, name: 'junk', listings: 'many' },
			{ ...ES, name: 'negative', listings: -3 }
		];
		expect(bubbles(points, GEOGRAPHY).map((b) => b.latlng)).toEqual([[39.5, -98.35]]);
	});

	it('places a bubble at the point, as [lat, lon]', () => {
		expect(bubbles([LISBON], GEOGRAPHY)[0].latlng).toEqual([38.72, -9.14]);
	});

	it('rings a town or geohash bubble in gold, and leaves a country centroid plain', () => {
		const [us, lisbon, geohash] = bubbles([US, LISBON, { ...LISBON, prec: 'geohash' }], GEOGRAPHY);
		expect(us.options).toEqual({ radius: 31, fillColor: '#a78bfa', color: '#a78bfa', weight: 1, opacity: 0.9, fillOpacity: 0.45 });
		expect(lisbon.options).toMatchObject({ fillColor: '#a78bfa', color: '#fbbf24', weight: 2 });
		expect(geohash.options).toMatchObject({ color: '#fbbf24', weight: 2 });
		expect(lisbon.popup).toContain('exact location');
		expect(us.popup).not.toContain('exact location');
	});

	it('treats a point with no precision as a plain country bubble (shipping destinations have none)', () => {
		const [b] = bubbles([{ lat: 53.2, lon: -7.4, name: 'Ireland', sellers: 38, options: 234 }], SHIPPING);
		expect(b.options).toMatchObject({ color: '#34d399', fillColor: '#34d399', weight: 1 });
		expect(b.popup).not.toContain('exact location');
	});

	it('writes the popup: name, the weight and the secondary figure with their labels', () => {
		expect(bubbles([ES], GEOGRAPHY)[0].popup).toBe('<b>Spain</b><br>100 listings<br>10 sellers');
		const [ie] = bubbles([{ lat: 53.2, lon: -7.4, name: 'Ireland', sellers: 38, options: 234 }], SHIPPING);
		expect(ie.popup).toBe('<b>Ireland</b><br>38 sellers ship here<br>234 shipping options');
	});

	it('leaves the secondary line out when the point has no such field, or the map asks for none', () => {
		expect(bubbles([{ ...ES, sellers: undefined }], GEOGRAPHY)[0].popup).toBe('<b>Spain</b><br>100 listings');
		expect(bubbles([ES], { ...GEOGRAPHY, secondary: null })[0].popup).toBe('<b>Spain</b><br>100 listings');
	});

	it('escapes the place name, since the popup is HTML', () => {
		const [b] = bubbles([{ ...ES, name: 'Bosnia & <Herzegovina> "x" \'y\'' }], GEOGRAPHY);
		expect(b.popup).toContain('<b>Bosnia &#38; &#60;Herzegovina&#62; &#34;x&#34; &#39;y&#39;</b>');
		expect(b.popup).not.toContain('<Herzegovina>');
	});

	it('returns nothing for no points, without dividing by zero', () => {
		expect(bubbles([], GEOGRAPHY)).toEqual([]);
		expect(bubbles([{ ...ES, listings: 0 }], GEOGRAPHY)).toEqual([]);
	});
});
