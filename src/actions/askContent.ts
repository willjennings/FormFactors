// The unspecified ask made first-class (spec §6). "Add a heading here" is not a failed call —
// the user deliberately left the content open. The agent asks back, and may offer up to three
// candidates drawn from the document. Candidates are SUGGESTIONS, never defaults: an
// unanswered ask expires into nothing.
import type { VoiceTool } from '../voice/types';

export const MAX_CANDIDATES = 3;
export const ASK_FIELDS = ['heading', 'body', 'slideTitle'] as const;

export interface AskState { field: string; question: string; candidates: string[] }

export const ASK_CONTENT_TOOL: VoiceTool = {
  name: 'ask_content',
  description: 'Ask the user what authorial content should say when they did not tell you — a heading, body text, or a slide title. Call this INSTEAD of guessing or sending a placeholder. Give one short question and up to three candidate answers drawn from the document (omit candidates if you have nothing sensible to suggest). The user answers by picking one, typing, or speaking.',
  parameters: { type: 'object', properties: {
    field: { type: 'string', enum: [...ASK_FIELDS], description: 'Which content you are asking about.' },
    question: { type: 'string', description: 'The short spoken question, e.g. "What would you like the heading to say?"' },
    candidates: { type: 'array', items: { type: 'string' }, description: `Up to ${MAX_CANDIDATES} suggested answers. Optional.` },
  }, required: ['field', 'question'] },
};

/** Indigo — the answer row is visibly its own thing, never mistaken for a task suggestion. */
export const ASK_CHIP_COLOR = '99,102,241';

export interface AskChip { key: string; label: string; phrase: string; color: string }

/** The chip row while an ask is open. Candidates are SUGGESTIONS: firing one sends that text as
 *  the user's own words down the ordinary input path — nothing is ever applied from a candidate
 *  here. An ask with no candidates yields an empty row; the question still stands in the omnibox,
 *  so typing and speaking remain the equal answers they always were. */
export function askChips(ask: AskState | null): AskChip[] {
  if (!ask) return [];
  return ask.candidates.map((phrase, i) => ({ key: `ask-${i}`, label: 'Answer', phrase, color: ASK_CHIP_COLOR }));
}

// A COMPARISON key, never a rewrite of anyone's words: fold case and every run of punctuation or
// whitespace to one space. Deliberately aggressive because the answer does not come back the way
// it was offered — the transcript cleaner in App strips any character outside a plain ASCII set,
// so an offered "Meridian — Q3" returns as "Meridian Q3" and must still count as the same answer.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Did the answer come from a candidate we offered? The measurement question is whether offering
 *  candidates helps, so this matches on TEXT, not on which widget fired: clicking a chip (which
 *  fills the omnibox and submits normally) and typing the same words are the same event to the
 *  user, and would otherwise be counted differently for no reason the data cares about. */
export function answeredFromCandidate(ask: AskState | null, text: string): boolean {
  if (!ask) return false;
  const t = norm(text);
  return !!t && ask.candidates.some((c) => norm(c) === t);
}

/** The model-facing ack when the GATE opened the ask — i.e. the model called an action verb with
 *  a placeholder instead of calling ask_content first. `ask` carries the USER's question (the
 *  trace renders that); `error` carries the MODEL's instruction. Two audiences, one call, never
 *  merged — the same split validate.ts's header states. */
export function gateAskAck(verb: string, needs: { field: string; question: string }) {
  return {
    success: false as const,
    ask: needs.question,
    error: `${needs.question} — that question is now on the user's screen and ${verb} was NOT applied. `
      + `Say it out loud. If the document suggests up to ${MAX_CANDIDATES} good answers, call ask_content to offer them. `
      + `Then wait for the user's answer and call ${verb} again with their words. `
      + `Never send a placeholder like "${needs.field}".`,
  };
}

export function askCallToState(args: unknown): { ask: AskState } | { error: string } {
  const a = (args ?? {}) as { field?: unknown; question?: unknown; candidates?: unknown };
  const field = String(a.field ?? '');
  if (!(ASK_FIELDS as readonly string[]).includes(field)) {
    return { error: `ask_content field must be one of: ${ASK_FIELDS.join(', ')}.` };
  }
  const question = String(a.question ?? '').trim();
  if (!question) return { error: 'ask_content needs a short question to speak.' };
  const raw = Array.isArray(a.candidates) ? a.candidates.map(String) : [];
  if (raw.length > MAX_CANDIDATES) {
    return { error: `ask_content takes at most ${MAX_CANDIDATES} candidates — pick your best ${MAX_CANDIDATES}.` };
  }
  return { ask: { field, question, candidates: raw.map((c) => c.trim()).filter(Boolean) } };
}
