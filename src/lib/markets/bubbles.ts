// The bubbles of the /marketplaces maps (BubbleMap.svelte), as plain data: where each one
// goes, how big it is drawn, and what its popup says. No Leaflet here, so it is unit-tested
// on its own (bubbles.test.ts).

export interface MapPoint {
	lat: number;
	lon: number;
	name: string;
	/** How the point was placed: `country` (its centroid), `city` or `geohash`. */
	prec?: string;
	[field: string]: unknown;
}

export interface BubbleSpec {
	/** Which numeric field sizes the bubble, and what to call it in the popup. */
	weight: string;
	weightLabel: string;
	/** An optional second figure for the popup, e.g. sellers under listings. */
	secondary: string | null;
	secondaryLabel: string;
	color: string;
}

export interface Bubble {
	latlng: [number, number];
	/** Leaflet circleMarker options, exactly as drawn. */
	options: {
		radius: number;
		fillColor: string;
		color: string;
		weight: number;
		opacity: number;
		fillOpacity: number;
	};
	popup: string;
}

const GOLD = '#fbbf24';

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * One bubble per point with a positive weight; the rest are not drawn. The radius grows
 * with the square root of the weight, so the bubble's AREA tracks the count (a linear
 * radius makes the US bubble swallow Europe): 5 px plus up to 26 for the heaviest point.
 * A point placed more precisely than its country (a named town, or a geohash to ~2 km)
 * gets a gold ring, and its popup says so.
 */
export function bubbles(points: MapPoint[], spec: BubbleSpec): Bubble[] {
	const value = (p: MapPoint) => Number(p[spec.weight]) || 0;
	const max = Math.max(1, ...points.map(value));
	const out: Bubble[] = [];
	for (const p of points) {
		const v = value(p);
		if (!(v > 0)) continue;
		const exact = !!p.prec && p.prec !== 'country';
		const sec =
			spec.secondary && p[spec.secondary] !== undefined
				? `<br>${Number(p[spec.secondary]).toLocaleString()} ${spec.secondaryLabel}`
				: '';
		out.push({
			latlng: [p.lat, p.lon],
			options: {
				radius: 5 + 26 * Math.sqrt(v / max),
				fillColor: spec.color,
				color: exact ? GOLD : spec.color,
				weight: exact ? 2 : 1,
				opacity: 0.9,
				fillOpacity: 0.45
			},
			// The name is escaped: it is a place name from the snapshot, but a popup is HTML.
			popup:
				`<b>${escapeHtml(String(p.name))}</b><br>${v.toLocaleString()} ${spec.weightLabel}${sec}` +
				(exact ? `<br><span style="color:${GOLD}">exact location</span>` : '')
		});
	}
	return out;
}
