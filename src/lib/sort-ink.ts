// The ink of a sortable table's cell, shared by /git's tables, /routstr's providers table and
// /marketplaces' Recent listings.

/**
 * Bright in the column the rows are sorted by at that moment, dim in every other (the
 * operator's rule, 2026-10-18), so the emphasis follows a reader's re-sort. A table's name
 * column keeps its own ink, and a cell whose colour carries meaning (a review's verdict, a
 * bitcoin price) its colour. `key` must be one of the table's own sort keys, so a typo fails to
 * compile rather than leave a column dim for good.
 */
export const sortInk = <K extends string>(sortKey: K, key: NoInfer<K>): string =>
	sortKey === key ? 'text-gray-200' : 'text-gray-400';
