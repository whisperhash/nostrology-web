// X-axis tick labels for a category axis whose labels are ISO days ('YYYY-MM-DD'),
// dense (one per day) OR sparse (weekly buckets, catalog versions - any subset).
//
// Rule: label the FIRST point and every point that starts a new month relative to
// the previous point; carry the year on the first label and whenever it changes.
// Thinning is by month step so a multi-year daily series does not collide.
//
// Why not "days ending in -01": a sparse series (weekly, epoch-aligned Thursdays;
// catalog versions on whatever day they were published) may contain NO first-of-
// month at all, which left /routstr's "Catalog size over time" with an empty axis
// and its cumulative-revenue chart with a year that never appeared (Jan 1 2026 fell
// in the weekly era). Month-CHANGE detection labels any series.
export type DayTick = string | string[] | undefined;

export function dayTickLabels(days: string[], monthStep: number, firstLabelDays = 20): DayTick[] {
	const out: DayTick[] = [];
	let prevYm: string | null = null;
	let prevYear: string | null = null;
	for (const d of days) {
		const ym = d.slice(0, 7);
		const year = d.slice(0, 4);
		if (ym === prevYm) {
			out.push(undefined);
			continue;
		}
		prevYm = ym;
		const month = Number(d.slice(5, 7));
		const yearChanged = year !== prevYear;
		prevYear = year;
		// Keep every label that starts a year, else thin by the month step.
		if (!yearChanged && out.length > 0 && (month - 1) % monthStep !== 0) {
			out.push(undefined);
			continue;
		}
		const label = new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', {
			month: 'short',
			timeZone: 'UTC'
		});
		out.push(yearChanged ? [label, year] : label);
	}
	// The first label is unconditional, so a series starting a few days before a step
	// month would draw two labels almost on top of each other (autoSkip is off). When
	// the next label is under firstLabelDays away, hand it the year and drop the first.
	// A caller that decides this by pixels instead passes 0.
	const next = out.findIndex((t, i) => i > 0 && t !== undefined);
	if (next > 0 && Date.parse(days[next]) - Date.parse(days[0]) < firstLabelDays * 86400_000) {
		const t = out[next];
		out[next] = Array.isArray(t) ? t : [t as string, days[next].slice(0, 4)];
		out[0] = undefined;
	}
	return out;
}

// Month step by canvas width: quarters wide, half-years mid, years narrow.
export function monthStepForWidth(w: number): number {
	return w < 520 ? 12 : w < 900 ? 6 : 3;
}
