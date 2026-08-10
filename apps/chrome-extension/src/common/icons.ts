/**
 * Drawing an icon.
 *
 * Every icon in the popup comes from Hugeicons' free Stroke Rounded set
 * (`@hugeicons/core-free-icons`, MIT). Their packages ship icons as data rather
 * than markup — a list of `[tag, attributes]` pairs on a 24x24 grid — and offer
 * renderers for React, Vue, Angular and Svelte. This popup has none of those,
 * so it renders the same data itself; that is all this file is.
 *
 * The attributes arrive React-shaped (`strokeWidth`, `strokeLinecap`) with a
 * `key` for React's list reconciliation, so both need translating on the way
 * into the DOM.
 */

/** One SVG element of an icon: its tag and its attributes. */
export type IconNode = readonly [
	string,
	Readonly<Record<string, string | number>>,
];

/** An icon, exactly as `@hugeicons/core-free-icons` exports it. */
export type IconData = readonly IconNode[];

const SVG_NS = "http://www.w3.org/2000/svg";

export function renderIcon(icon: IconData, className: string): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("class", className);
	svg.setAttribute("aria-hidden", "true");
	/*
	 * These are stroke drawings: the nodes set `stroke` and leave `fill` alone,
	 * and an unset fill paints black. Without this every icon is a silhouette.
	 */
	svg.setAttribute("fill", "none");

	for (const [tag, attributes] of icon) {
		const node = document.createElementNS(SVG_NS, tag);
		for (const [name, value] of Object.entries(attributes)) {
			if (name === "key") continue; // React's, not the DOM's.
			node.setAttribute(toAttributeName(name), String(value));
		}
		svg.append(node);
	}

	return svg;
}

/** `strokeLinecap` → `stroke-linecap`. */
function toAttributeName(name: string): string {
	return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
