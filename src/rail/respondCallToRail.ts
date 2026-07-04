import type { SceneEntity } from '../entities/registry';
import { resolveEchoedTarget } from '../entities/registry';
import type { MockDoc } from '../scenarios';
import { BUDGETS, DO_VERBS, type Rail, type RailCard, type CardType } from './types';
import { evaluatePredicate } from './predicate';

// The honest mapper (teachCallToEvent's sibling). Structural violations fail the WHOLE
// call as data; over-budget prose DEMOTES to the WHY slot (the paragraph tax); an
// unresolvable target is NOT an error — it renders hollow (deliberate divergence from
// teaching, where the agent must never teach AT a guessed element).

const CARD_TYPES: CardType[] = ['do', 'answer', 'orient', 'check', 'caution', 'concept', 'try', 'recap'];
const err = (m: string) => ({ error: m });

/** Trim `text` to `max`, pushing the overflow (whole-word) into the card's why slot. */
function budget(text: string, max: number, card: RailCard): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max);
  const head = text.slice(0, cut > 0 ? cut : max).trimEnd();
  const tail = text.slice(head.length).trim();
  card.why = card.why ? `${tail} — ${card.why}` : tail;
  return head;
}

export function respondCallToRail(
  args: unknown, entities: SceneEntity[], doc: MockDoc, now: number,
): { rail: Rail; guideLine?: string } | { error: string } {
  const a = args as { seq?: unknown; cards?: unknown; guideLine?: unknown };
  if (!a || typeof a.seq !== 'string' || !a.seq) return err('respond requires a string "seq".');
  if (typeof a.guideLine !== 'string' || !a.guideLine.trim()) return err('respond requires exactly one guideLine sentence.');
  if (!Array.isArray(a.cards) || a.cards.length === 0) return err('respond requires a non-empty "cards" array.');

  const cards: RailCard[] = [];
  for (const [i, raw] of (a.cards as Record<string, unknown>[]).entries()) {
    const t = raw?.t as CardType;
    if (!CARD_TYPES.includes(t)) return err(`Card ${i}: unknown card type "${String(raw?.t)}".`);
    const card: RailCard = { t, band: 'solid', state: 'pending', why: typeof raw.why === 'string' ? raw.why : undefined };

    const bindTarget = (): string | null | undefined => {
      if (typeof raw.target !== 'string' || !raw.target) return undefined;
      card.target = raw.target;
      const hit = resolveEchoedTarget(entities, raw.target);
      card.entityId = hit ? (hit.entity.id as string) : null;
      card.band = hit ? 'solid' : 'hollow';
      return card.entityId;
    };

    switch (t) {
      case 'do': {
        if (typeof raw.verb !== 'string' || !(DO_VERBS as readonly string[]).includes(raw.verb))
          return err(`Card ${i}: DO verb must be one of ${DO_VERBS.join('/')}.`);
        if (typeof raw.text !== 'string' || !raw.text) return err(`Card ${i}: DO requires an action "text".`);
        if (typeof raw.result !== 'string' || !raw.result) return err(`Card ${i}: DO requires a "result" line.`);
        if (typeof raw.target !== 'string' || !raw.target) return err(`Card ${i}: DO requires a "target".`);
        card.verb = raw.verb; bindTarget();
        card.text = budget(raw.text, BUDGETS.doAction, card);
        card.result = budget(raw.result, BUDGETS.doResult, card);
        break;
      }
      case 'answer': {
        if (typeof raw.text !== 'string' || !raw.text) return err(`Card ${i}: ANSWER requires "text".`);
        bindTarget();
        card.text = budget(raw.text, BUDGETS.answer, card);
        break;
      }
      case 'orient': case 'caution': {
        if (typeof raw.text !== 'string' || !raw.text) return err(`Card ${i}: ${t.toUpperCase()} requires "text".`);
        card.text = budget(raw.text, t === 'orient' ? BUDGETS.orient : BUDGETS.caution, card);
        if (t === 'orient') card.state = 'done'; // context, never a gate
        else bindTarget(); // caution is entity-bound per grammar §4; target is optional
        break;
      }
      case 'check': {
        if (raw.verify !== 'auto' && raw.verify !== 'user') return err(`Card ${i}: CHECK requires verify:"auto"|"user".`);
        if (typeof raw.text !== 'string' || !raw.text) return err(`Card ${i}: CHECK requires "text".`);
        card.verify = raw.verify;
        if (raw.verify === 'auto') {
          const ex = raw.expect as { path?: unknown; equals?: unknown } | undefined;
          if (!ex || typeof ex.path !== 'string') return err(`Card ${i}: auto CHECK requires expect.path.`);
          if (evaluatePredicate(doc, { path: ex.path, equals: ex.equals }) === null)
            return err(`Card ${i}: CHECK path "${ex.path}" does not exist on the current document.`);
          card.expect = { path: ex.path, equals: ex.equals };
        }
        card.text = budget(raw.text, BUDGETS.check, card);
        bindTarget(); // check is entity-bound per grammar §4; target is optional
        break;
      }
      case 'concept': {
        if (typeof raw.front !== 'string' || typeof raw.back !== 'string') return err(`Card ${i}: CONCEPT requires front and back.`);
        card.front = budget(raw.front, BUDGETS.conceptFront, card);
        card.back = budget(raw.back, BUDGETS.conceptBack, card);
        if (typeof raw.analogy === 'string') card.analogy = budget(raw.analogy, BUDGETS.conceptAnalogy, card);
        break;
      }
      case 'try': {
        if (typeof raw.prompt !== 'string' || typeof raw.notice !== 'string') return err(`Card ${i}: TRY requires prompt and notice.`);
        bindTarget();
        card.prompt = budget(raw.prompt, BUDGETS.tryPrompt, card);
        card.notice = budget(raw.notice, BUDGETS.tryNotice, card);
        break;
      }
      case 'recap': {
        if (!Array.isArray(raw.lines) || raw.lines.length === 0) return err(`Card ${i}: RECAP requires lines.`);
        if (raw.lines.length > BUDGETS.recapLines) return err(`Card ${i}: RECAP is ${BUDGETS.recapLines} lines max.`);
        card.lines = (raw.lines as string[]).map(l => budget(String(l), BUDGETS.recapLine, card));
        break;
      }
    }
    cards.push(card);
  }

  const activeIndex = cards.findIndex(c => c.state === 'pending');
  if (activeIndex >= 0) cards[activeIndex].state = 'active';
  return { rail: { seq: a.seq, cards, activeIndex: activeIndex >= 0 ? activeIndex : null, guideLine: a.guideLine, startedAt: now }, guideLine: a.guideLine };
}
