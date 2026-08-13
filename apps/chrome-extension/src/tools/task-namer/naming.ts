/**
 * Selected text in, one English task title out.
 *
 * Only the service worker imports this, so neither the instruction nor the
 * OpenRouter client ships to a page.
 */

import {
	complete,
	type OpenRouterSettings,
	OpenRouterError,
} from "../../common/openrouter";
import { MAX_SELECTION_LENGTH } from "./constants";

/**
 * The output contract, not the input language.
 *
 * Nothing here says "Vietnamese". The model recognises it perfectly well on its
 * own, and naming the source language pushes it towards translating the
 * sentence literally instead of restating what the work is — which is the whole
 * point of a task title.
 *
 * The rules are the conventions an engineering team's board already follows:
 * an imperative verb, so the title says what will be done rather than what
 * exists; sentence case, because Title Case On Every Word reads as a heading;
 * no trailing period, because a title is not a sentence; and no ticket id,
 * because the tracker adds its own and a hallucinated one is worse than none.
 */
export const TASK_NAME_INSTRUCTION = [
	"You rewrite text into a single task title for a software engineering issue tracker such as Jira or Linear.",
	"",
	"Rules:",
	"- Answer with the title only. No preamble, no explanation, no quotes, no code fences, no alternatives.",
	"- Always answer in English, whatever language the input is in.",
	"- Start with an imperative verb: Add, Fix, Remove, Refactor, Update, Migrate, Document, Investigate, and so on.",
	"- Sentence case: capitalise the first word and proper nouns only.",
	"- No trailing period. No ticket id or prefix such as [BE] or FEAT-123.",
	"- At most 12 words. Prefer the shortest title that still says which thing changes and how.",
	"- Keep identifiers, product names, file paths and API names exactly as written in the input.",
	"- Use the standard vocabulary of the industry, not a literal word-for-word translation.",
	"- If the input already is an English task title, correct its grammar and conventions and return it.",
].join("\n");

/** Rewrite `selection` as one task title. Throws {@link OpenRouterError}. */
export async function toTaskName(
	settings: OpenRouterSettings,
	selection: string,
): Promise<string> {
	const source = selection.trim().slice(0, MAX_SELECTION_LENGTH);
	if (!source) throw new OpenRouterError("Select some text first.");

	// No `maxTokens` override. Sizing the ceiling to the title is the obvious
	// thing and the wrong one — see MAX_ANSWER_TOKENS in common/openrouter.ts.
	const answer = await complete({
		settings,
		system: TASK_NAME_INSTRUCTION,
		user: source,
	});

	return clean(answer);
}

/**
 * Undo the three things a model does anyway, however the instruction is worded:
 * wrap the answer in quotes, end it with a period, or lead with "Task title:".
 * Cheaper to strip here than to keep bargaining with it in the prompt.
 */
export function clean(answer: string): string {
	let text = answer.trim();

	// Only ever one line of it — anything after the first is commentary.
	const [firstLine = ""] = text.split("\n");
	text = firstLine.trim();

	text = text.replace(/^(?:task\s*)?(?:title|name)\s*:\s*/i, "");
	text = text.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "");
	text = text.replace(/[.]+$/, "");

	return text.trim();
}
