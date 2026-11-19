// The REAL Chart.js under jsdom, for a test whose claim depends on what it really picks (the
// ticks) or where it really puts them. A component test mocks 'chart.js' with a fake that records
// the configuration, as in ngit/StackedBars.config.test.ts; hand that configuration to drawReal.
// jsdom has no canvas, so text is measured by a stub: CHAR_PX a character, a little generous for
// the 12 px axis labels (a real one measures "Mar" at 22 px and "2026" at 27 px).
import { vi } from 'vitest';

const CHAR_PX = 8;

/** Enough of a 2D context for a fake Chart or a real one: text has a width, and all else is a no-op. */
export function stubCanvasContext() {
	HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
		const known: Record<string | symbol, unknown> = {
			canvas: this,
			measureText: (text: string) => ({ width: String(text).length * CHAR_PX })
		};
		return new Proxy(known, {
			get: (t, k) => (k in t ? t[k] : () => {}),
			set: (t, k, v) => ((t[k] = v), true)
		});
	} as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

/** Draws `cfg`, as a component handed it to its Chart, on a canvas of this size. */
export async function drawReal(cfg: unknown, width: number, height = 240) {
	const { Chart, registerables } = await vi.importActual<typeof import('chart.js')>('chart.js');
	Chart.register(...registerables);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const given = cfg as ConstructorParameters<typeof Chart>[1];
	return new Chart(canvas, {
		...given,
		// no ResizeObserver in jsdom, and nothing here to animate
		options: { ...given.options, responsive: false, animation: false }
	});
}

type Drawn = Awaited<ReturnType<typeof drawReal>>;

/** The labels an axis really draws, a two-line one joined by a space, in order. */
export function drawnLabels(chart: Drawn, axis: string): string[] {
	return chart.scales[axis].ticks
		.map((t) => (Array.isArray(t.label) ? t.label.join(' ') : String(t.label ?? '')))
		.filter((l) => l !== '');
}

type Box = { text: string; left: number; right: number };

function labelBoxes(chart: Drawn): Box[] {
	const x = chart.scales.x;
	return x.ticks.flatMap((t, i) => {
		if (t.label === '' || t.label == null) return [];
		const lines = ([] as unknown[]).concat(t.label).map(String);
		const half = (Math.max(...lines.map((l) => l.length)) * CHAR_PX) / 2;
		const at = x.getPixelForTick(i);
		return [{ text: lines.join(' '), left: at - half, right: at + half }];
	});
}

/** Each pair of neighbouring x-axis labels whose boxes overlap, as they would be drawn. */
export function collisions(chart: Drawn): string[] {
	const boxes = labelBoxes(chart);
	return boxes.slice(1).flatMap((b, i) => (boxes[i].right > b.left ? [`${boxes[i].text} / ${b.text}`] : []));
}

/** Each x-axis label that runs off either side of the canvas. */
export function offCanvas(chart: Drawn): string[] {
	return labelBoxes(chart)
		.filter((b) => b.left < 0 || b.right > chart.width)
		.map((b) => b.text);
}
