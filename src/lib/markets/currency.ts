// Which `price` units are bitcoin, for what the page draws itself: Recent listings' Price column.
//
// THE DEFINITION IS THE PIPELINE'S, and this is a copy of it. nostrology-data's
// dagster_code/pipeline/marketplaces.py (BTC_UNITS, folded by markets_geolib.norm) decides what
// the snapshot counts as "Bitcoin (BTC / sats)", which is the share the Priced in bitcoin card
// states, and nostrology-data's crosscheck/build_markets_snapshot.py re-derives it. The snapshot ships the
// counts and not the set, and a row of marketplaces_listings carries only a `price` tag, so this
// side has to hold the same set and fold a unit the same way: otherwise a row drawn orange is not
// a row counted in that share. Those two files and markets_geolib name this one,
// because no test can reach across the repositories. Change them together, with the page's own
// sentence listing the units and nostrology-data's docs/dataset-reference/markets-dataset-reference.md.
//
// `TESTSAT` IS NOT BITCOIN, deliberately. It is test money, the pipeline counts it under "Other",
// and the live pool carried 3 such rows on 2026-11-04. The page's own sentence lists the seven
// units a reader needs ("btc, sats, sat, msat, satoshi, bitcoin and xbt"); `msats`, `satoshis` and
// `sat(s)` below are spellings of those.
//
// IT GOES BY THE UNIT, as the card does. A listing that names bitcoin only inside its amount
// (`["price", "400,000 sats per hour"]`, 7 live rows on 2026-11-04) has no unit, so the card does
// not count it and it is not drawn as counted.
//
// WHERE THE TWO CAN STILL DIFFER, on paper: neither has happened in the live pool. A NUL inside a
// unit is counted as "Other" and then stripped on the way into Postgres, which refuses it, so this
// side reads the clean word. And a letter whose decomposition is newer than the deployed Python's
// Unicode tables folds here and not there. Each takes a seller crafting the unit to do it.
//
// EXPORTED FOR ITS TEST, which holds it to the pipeline's set in both directions.
export const BTC_UNITS: ReadonlySet<string> = new Set(['btc', 'sats', 'sat', 'msat', 'msats', 'satoshi', 'satoshis', 'bitcoin', 'xbt', 'sat(s)']);

/**
 * markets_geolib.norm, so a unit folds here as it does there. NFKD, then every character outside
 * ASCII dropped (so SAT in full-width letters is `sat`, and a zero-width space inside "sats"
 * vanishes), then runs of whitespace collapsed, the ends trimmed and the case folded.
 *
 * `\x1c-\x1f` IS NOT DECORATION. Python's str.strip() and regex `\s` count those four separators
 * as whitespace and JavaScript's do not, so without them a unit the pipeline counts would not be
 * drawn as counted. Everything is ASCII by the time they are tested, which is why nothing else
 * differs between the two languages' definitions.
 */
const norm = (unit: string): string =>
	unit
		.normalize('NFKD')
		.replace(/[^\x00-\x7f]/g, '')
		.replace(/[\s\x1c-\x1f]+/g, ' ')
		.trim()
		.toLowerCase();

/**
 * Whether a `price` tag's third element names bitcoin in any of its denominations.
 *
 * TAKES `unknown`, AND ANSWERS FALSE RATHER THAN THROWING: the tag is a stranger's, this runs in
 * a reactive block the server render materialises, and a throw there is a 500 (internal server
 * error) for the whole of /marketplaces. A missing third element arrives here as undefined.
 */
export const isBitcoinUnit = (unit: unknown): boolean =>
	typeof unit === 'string' && BTC_UNITS.has(norm(unit));
