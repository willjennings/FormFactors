import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appendEntry, replay, type JournalEntry } from './journal';
import { JOURNAL_REGISTRY, workspaceReduce, initialWorkspaceState, dialsReduce, initialDialsState, DEFAULT_DESK_RECT } from './registry';
import { deskReduce, initialDeskState, programWindowId, artifactWindowId } from '../shell/desk/deskStore';
import { fitWindows } from '../shell/desk/selectors';
import { DEFAULT_PROGRAM } from '../scenarios';
import { reduce as artifactReduce, initialArtifactState } from '../artifacts/artifactStore';
import { reduce as goalReduce, initialGoalState } from '../goal/goalStore';
import { validateCombineCall } from '../artifacts/combineTools';
import { validateRefineCall } from '../artifacts/refineTools';
import { pinEventFor } from '../artifacts/pin';
import { ARTIFACT_DEMO_ARGS, ARTIFACT_DEMO_REFINE_ARGS } from '../artifacts/demo';
import { seedCorpus } from '../artifacts/seeds';
import { DEFAULT_DIALS } from '../register/registry';

// Clock-separation harness (Task 5 review, round 1, Critical): the live fold and the replay
// fold of the SAME events can execute within the same wall-clock millisecond, so a latent
// Date.now() read inside a reducer can return an identical value both times and the assertion
// below would false-pass (measured ~99.95% collision over 2000 trials). Fake timers force the
// two folds apart by several real minutes — the same separation a real reload produces, made
// deterministic instead of probabilistic. This changes ONLY the harness: no event, no
// assertion, and no production file is touched.
const EPOCH = 1_700_000_000_000;
const SEPARATION_MS = 5 * 60 * 1000;

// THE KEYSTONE (spec §9): drive each store's REAL event stream live and via replay; the end
// states must be deeply equal. The day a reducer reads Date.now() internally, this fails.
describe('replay equals live', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    // Runs even on assertion failure — real timers must never leak into later test files.
    vi.useRealTimers();
  });

  it('artifacts — a real create → refine → pin → close stream', () => {
    vi.setSystemTime(EPOCH);
    const corpus = seedCorpus();
    let live = initialArtifactState();
    let j: JournalEntry[] = [];
    const drive = (event: any) => { live = artifactReduce(live, event); j = appendEntry(j, 'artifacts', event, j.length + 1); };

    const created = validateCombineCall(ARTIFACT_DEMO_ARGS, corpus, live, 1000);
    if (!('event' in created)) throw new Error('demo combine must validate');
    drive(created.event);
    const refined = validateRefineCall(ARTIFACT_DEMO_REFINE_ARGS, live, 2000);
    if (!('event' in refined)) throw new Error('demo refine must validate');
    drive(refined.event);
    const pinned = pinEventFor({ t: 'answer', band: 'solid', state: 'active', text: 'Keep this.' } as any, 'Seq', 3000);
    if (!('event' in pinned)) throw new Error('pin must build');
    drive(pinned.event);
    drive({ type: 'artifact.close', id: 'a2' });
    // A REJECTED event journals too (spec §3): stale revise no-ops identically both ways.
    drive({ type: 'artifact.revise', id: 'a1', baseRev: 1, patch: { op: 'retitle', title: 'X' }, owner: 'agent', at: 4000 });

    vi.setSystemTime(EPOCH + SEPARATION_MS);
    expect((replay(j, JOURNAL_REGISTRY) as any).artifacts).toEqual(live);
  });

  it('workspace — edits, swaps, and back', () => {
    vi.setSystemTime(EPOCH);
    let live = initialWorkspaceState();
    let j: JournalEntry[] = [];
    const drive = (event: any) => { live = workspaceReduce(live, event); j = appendEntry(j, 'workspace', event, j.length + 1); };
    drive({ type: 'doc.set', program: 'word', doc: { ...seedCorpus().word, text: 'edited' } });
    drive({ type: 'program.set', program: 'excel' });
    drive({ type: 'doc.set', program: 'excel', doc: seedCorpus().excel });
    drive({ type: 'program.set', program: 'word' });
    vi.setSystemTime(EPOCH + SEPARATION_MS);
    expect((replay(j, JOURNAL_REGISTRY) as any).workspace).toEqual(live);
  });

  it('goal — set, commit, done, clear', () => {
    vi.setSystemTime(EPOCH);
    let live = initialGoalState();
    let j: JournalEntry[] = [];
    const drive = (event: any) => { live = goalReduce(live, event); j = appendEntry(j, 'goal', event, j.length + 1); };
    drive({ type: 'goal.set', objective: 'Ship it', steps: [{ label: 'save the file', verb: 'save_file' }] });
    drive({ type: 'goal.actionCommitted', verb: 'save_file' });
    drive({ type: 'goal.clear' });
    vi.setSystemTime(EPOCH + SEPARATION_MS);
    expect((replay(j, JOURNAL_REGISTRY) as any).goal).toEqual(live);
  });

  it('desk — open, move, minimize, skin, focus, close', () => {
    vi.setSystemTime(EPOCH);
    // Starts from the registry's own initial state, which is what `replay` folds onto — a desk
    // seeded any other way would compare two different origins and prove nothing.
    let live = initialDeskState(DEFAULT_PROGRAM, DEFAULT_DESK_RECT);
    let j: JournalEntry[] = [];
    const drive = (event: any) => { live = deskReduce(live, event); j = appendEntry(j, 'desk', event, j.length + 1); };
    drive({ type: 'window.open', id: artifactWindowId('a1'), kind: 'artifact', refId: 'a1',
      rect: { x: 560, y: 80, w: 380, h: 300 }, origin: 'agent', at: 1000 });
    drive({ type: 'window.move', id: programWindowId(DEFAULT_PROGRAM), rect: { x: 120, y: 90, w: 680, h: 620 } });
    drive({ type: 'window.minimize', id: programWindowId(DEFAULT_PROGRAM) });
    drive({ type: 'desk.skin', skin: 'provenance' });
    drive({ type: 'window.focus', id: programWindowId(DEFAULT_PROGRAM) });   // raises z AND un-minimizes
    drive({ type: 'window.close', id: artifactWindowId('a1') });
    // An event naming an unknown id no-ops identically on both sides (spec §1).
    drive({ type: 'window.minimize', id: artifactWindowId('ghost') });
    vi.setSystemTime(EPOCH + SEPARATION_MS);
    expect((replay(j, JOURNAL_REGISTRY) as any).desk).toEqual(live);
  });

  it('desk — a boot-fit onto a smaller screen replays exactly', () => {
    vi.setSystemTime(EPOCH);
    // The registry's initial() hands out the PRE-clamp default rect, so a desk booting onto a
    // short viewport has to be fitted. The fit is a REAL change to the desk, so App journals one
    // window.move per fitted window rather than clamping silently: an unjournaled clamp would
    // leave live and replay disagreeing by exactly that correction, which is the I1 defect.
    let live = initialDeskState(DEFAULT_PROGRAM, DEFAULT_DESK_RECT);
    let j: JournalEntry[] = [];
    const drive = (event: any) => { live = deskReduce(live, event); j = appendEntry(j, 'desk', event, j.length + 1); };
    const fits = fitWindows(live, { width: 1280, height: 640 });
    expect(fits.length).toBe(1);                       // the fit must actually be needed here
    for (const f of fits) drive({ type: 'window.move', id: f.id, rect: f.rect });
    expect(j.map(e => (e.event as any).type)).toEqual(['window.move']);   // journaled, not silent
    expect(fitWindows(live, { width: 1280, height: 640 })).toEqual([]);   // and now it settles
    vi.setSystemTime(EPOCH + SEPARATION_MS);
    expect((replay(j, JOURNAL_REGISTRY) as any).desk).toEqual(live);
  });

  it('dials — twiddle and land on custom', () => {
    vi.setSystemTime(EPOCH);
    let live = initialDialsState();
    let j: JournalEntry[] = [];
    const e = { type: 'dials.set' as const, dials: { ...DEFAULT_DIALS, honest: !DEFAULT_DIALS.honest }, registerKey: null };
    live = dialsReduce(live, e); j = appendEntry(j, 'dials', e, 1);
    vi.setSystemTime(EPOCH + SEPARATION_MS);
    expect((replay(j, JOURNAL_REGISTRY) as any).dials).toEqual(live);
  });
});
