import { describe, it, expect } from 'vitest';
import { isDuplicateConfirm } from './dedupe';

describe('isDuplicateConfirm (fix round 1, I3)', () => {
  it('true when the pending action was confirmed and this call repeats its verb + target', () => {
    expect(isDuplicateConfirm({ verb: 'edit_content', target: 'Cell B5', confirmed: true }, 'edit_content', 'Cell B5')).toBe(true);
  });
  it('true when the follow-up call omits the target — it falls back to the pending target', () => {
    expect(isDuplicateConfirm({ verb: 'edit_content', target: 'Cell B5', confirmed: true }, 'edit_content', undefined)).toBe(true);
  });
  it('false when there is no pending action', () => {
    expect(isDuplicateConfirm(null, 'edit_content', 'Cell B5')).toBe(false);
    expect(isDuplicateConfirm(undefined, 'edit_content', 'Cell B5')).toBe(false);
  });
  it('false when the pending action was never confirmed (still witnessed, awaiting the user)', () => {
    expect(isDuplicateConfirm({ verb: 'edit_content', target: 'Cell B5', confirmed: false }, 'edit_content', 'Cell B5')).toBe(false);
  });
  it('false when the verb differs', () => {
    expect(isDuplicateConfirm({ verb: 'format_content', target: 'Cell B5', confirmed: true }, 'edit_content', 'Cell B5')).toBe(false);
  });
  it('false when the target genuinely differs (a real second edit, not a resend)', () => {
    expect(isDuplicateConfirm({ verb: 'edit_content', target: 'Cell B5', confirmed: true }, 'edit_content', 'Cell C9')).toBe(false);
  });
});
