export type CardType = 'do' | 'answer' | 'orient' | 'check' | 'caution' | 'concept' | 'try' | 'recap';
export type Band = 'solid' | 'hollow';
export type CardState = 'pending' | 'active' | 'done' | 'failed';
export interface RailCard {
  t: CardType;
  text?: string;                       // answer/orient/check/caution
  verb?: string; target?: string;      // do
  entityId?: string | null;            // resolved id, null = hollow
  band: Band;
  result?: string;                     // do
  why?: string;                        // collapsed prose (incl. demoted overflow)
  front?: string; back?: string; analogy?: string;   // concept
  prompt?: string; notice?: string;                  // try
  lines?: string[];                    // recap
  verify?: 'auto' | 'user';            // check
  expect?: { path: string; equals: unknown };        // check auto
  state: CardState;
}
export interface Rail { seq: string; cards: RailCard[]; activeIndex: number | null; guideLine?: string; startedAt: number; }
export const BUDGETS = { doAction: 90, doResult: 60, answer: 80, orient: 90, check: 80, caution: 90, conceptFront: 60, conceptBack: 160, conceptAnalogy: 80, tryPrompt: 90, tryNotice: 60, recapLine: 60, recapLines: 3 } as const;
export const DO_VERBS = ['click', 'press', 'type', 'drag', 'open'] as const;
