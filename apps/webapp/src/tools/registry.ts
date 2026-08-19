import { GameController01Icon } from "@hugeicons/core-free-icons";
import type { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

/**
 * Every tool this app hosts, in one list.
 *
 * The sidebar and the dashboard both render from here, so adding a tool is this file
 * plus its route — never a third place that has to be remembered. The extension's
 * `src/common/registry.ts` is the same idea for the same reason.
 *
 * `to` is a plain string rather than a typed route id: the registry is imported by
 * the shell, and importing route modules to borrow their types is what puts URL
 * declarations on the import graph of every component.
 */
export interface ToolDefinition {
	id: string;
	/** Shown in the sidebar and on the dashboard card. */
	name: string;
	/** One line — what the tool is for, not how it works. */
	description: string;
	icon: ComponentProps<typeof HugeiconsIcon>["icon"];
	to: string;
}

export const TOOLS: ToolDefinition[] = [
	{
		id: "mlbb-collection",
		name: "Bộ sưu tập Mobile Legends",
		description:
			"Đánh dấu tướng và trang phục bạn đã có, xem còn thiếu những gì.",
		icon: GameController01Icon,
		to: "/tools/mlbb",
	},
];
