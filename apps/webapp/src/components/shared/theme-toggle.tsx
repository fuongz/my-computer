import {
	ComputerIcon,
	Moon02Icon,
	Sun01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip.tsx";
import { getStoredTheme, setStoredTheme, type Theme } from "#/lib/theme.ts";

const ORDER: Theme[] = ["system", "light", "dark"];

const FACE: Record<Theme, { icon: typeof Sun01Icon; label: string }> = {
	system: { icon: ComputerIcon, label: "Theo hệ thống" },
	light: { icon: Sun01Icon, label: "Giao diện sáng" },
	dark: { icon: Moon02Icon, label: "Giao diện tối" },
};

/**
 * Cycles system → light → dark.
 *
 * The stored value lives in localStorage, which the server cannot read — so until the
 * component mounts it renders the system face rather than guessing. The page itself
 * does not flash: `THEME_INIT_SCRIPT` has already applied the right palette to <html>
 * before React runs. Only this button's icon settles a tick late.
 */
export function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>("system");
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setTheme(getStoredTheme());
		setMounted(true);
	}, []);

	const face = FACE[mounted ? theme : "system"];

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						aria-label={`Giao diện: ${face.label}. Đổi sang chế độ tiếp theo.`}
						onClick={() => {
							const next =
								ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? "system";
							setTheme(next);
							setStoredTheme(next);
						}}
					>
						<HugeiconsIcon icon={face.icon} size={16} />
					</Button>
				}
			/>
			<TooltipContent>{face.label}</TooltipContent>
		</Tooltip>
	);
}
