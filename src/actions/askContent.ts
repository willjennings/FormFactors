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
