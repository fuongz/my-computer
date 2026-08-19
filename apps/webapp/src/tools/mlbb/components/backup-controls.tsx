import {
	Delete02Icon,
	Download01Icon,
	Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, useRef, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { cn } from "#/lib/utils.ts";
import {
	exportCollection,
	importCollection,
	useCollection,
} from "#/tools/mlbb/store.ts";

type Message = { tone: "ok" | "error"; text: string };

/**
 * Export, import, and start over.
 *
 * The collection lives in this browser's localStorage and nowhere else, so these
 * three buttons are the only way it survives a cleared cache or reaches a second
 * device. That makes the export not a nice-to-have but the backup story.
 */
export function BackupControls() {
	const reset = useCollection((s) => s.reset);
	const fileInput = useRef<HTMLInputElement>(null);
	const fileInputId = useId();
	const [message, setMessage] = useState<Message | null>(null);

	function download() {
		const file = exportCollection();
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(file, null, "\t")], {
				type: "application/json",
			}),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = `mlbb-collection-${file.exportedAt.slice(0, 10)}.json`;
		link.click();
		URL.revokeObjectURL(url);
		setMessage({
			tone: "ok",
			text: `Đã xuất ${file.heroes.length} tướng và ${file.skins.length} trang phục.`,
		});
	}

	async function upload(file: File) {
		try {
			const result = importCollection(JSON.parse(await file.text()));
			setMessage({
				tone: "ok",
				text:
					`Đã nhập ${result.heroes} tướng và ${result.skins} trang phục.` +
					(result.unknown
						? ` Bỏ qua ${result.unknown} mục không còn trong dữ liệu.`
						: ""),
			});
		} catch (error) {
			setMessage({
				tone: "error",
				text: error instanceof Error ? error.message : "Không đọc được tệp.",
			});
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button variant="outline" size="sm" onClick={download}>
				<HugeiconsIcon icon={Download01Icon} size={14} />
				Xuất tệp
			</Button>

			<Button
				variant="outline"
				size="sm"
				onClick={() => fileInput.current?.click()}
			>
				<HugeiconsIcon icon={Upload01Icon} size={14} />
				Nhập tệp
			</Button>
			<input
				id={fileInputId}
				ref={fileInput}
				type="file"
				accept="application/json,.json"
				className="sr-only"
				aria-label="Chọn tệp sao lưu bộ sưu tập"
				onChange={(event) => {
					const file = event.target.files?.[0];
					// Clear first: picking the same file twice in a row fires no `change`
					// otherwise, and a failed import is exactly when somebody retries.
					event.target.value = "";
					if (file) void upload(file);
				}}
			/>

			<Dialog>
				<DialogTrigger
					render={
						<Button variant="ghost" size="sm">
							<HugeiconsIcon icon={Delete02Icon} size={14} />
							Xoá hết
						</Button>
					}
				/>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Xoá toàn bộ đánh dấu?</DialogTitle>
						<DialogDescription>
							Mọi tướng và trang phục đang được đánh dấu "đã có" sẽ bị bỏ đánh
							dấu. Thao tác này không hoàn tác được — hãy xuất tệp trước nếu bạn
							chưa chắc.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>Huỷ</DialogClose>
						<DialogClose
							render={
								<Button
									variant="destructive"
									onClick={() => {
										reset();
										setMessage({
											tone: "ok",
											text: "Đã xoá toàn bộ đánh dấu.",
										});
									}}
								/>
							}
						>
							Xoá hết
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{message ? (
				<p
					role="status"
					className={cn(
						"text-xs",
						message.tone === "ok"
							? "text-muted-foreground"
							: "text-destructive",
					)}
				>
					{message.text}
				</p>
			) : null}
		</div>
	);
}
