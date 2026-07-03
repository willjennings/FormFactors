import React, { useEffect, useRef, useState } from 'react';
import type { SceneEntity, EntityId } from '../entities/registry';
import { displayName } from '../entities/registry';
import type { TeachingEvent, TeachingState } from './types';
import { initialTeachingState, reduce } from './teachingStore';
import { activeStep, visibleScaffold, blockedEntityIds, fadeLevel } from './selectors';
import { buildDemoScript } from './demoScript';
import { loadCompetence, saveCompetence } from './persistence';
import { telemetry } from '../telemetry';

const pct = (v: number) => `${v / 10}%`; // 0-1000 space → percentage of the container

type Props = {
  entities: SceneEntity[];
  demo?: boolean;
  dispatchRef?: React.MutableRefObject<((e: TeachingEvent) => void) | null>; // Plan 2 seam
};

export function TeachingLayer({ entities, demo = false, dispatchRef }: Props) {
  const [state, setState] = useState<TeachingState>(() => ({ ...initialTeachingState(), competence: loadCompetence() }));
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = (e: TeachingEvent) => {
    const prior = stateRef.current;
    const next = reduce(prior, e, Date.now());
    if (next.competence !== prior.competence) saveCompetence(next.competence);
    if (e.type === 'teach.sequence') telemetry.guidance('sequence_start', { taskKey: e.taskKey, posture: e.posture, fadeLevel: fadeLevel(prior, e.taskKey) });
    if (e.type === 'teach.relate') telemetry.guidance('relate_shown', {});
    if (e.type === 'user.reveal') telemetry.guidance('reveal', {});
    if (e.type === 'user.dismiss' && prior.sequence && prior.sequence.activeIndex !== null) telemetry.guidance('sequence_abandoned', { taskKey: prior.sequence.taskKey });
    if (prior.sequence && next.sequence && prior.sequence.activeIndex !== null && next.sequence.activeIndex === null)
      telemetry.guidance('sequence_complete', { taskKey: prior.sequence.taskKey, fadeLevel: fadeLevel(prior, prior.sequence.taskKey) });
    if (e.type === 'user.stepAction' && next.sequence && prior.sequence && (next.sequence.blockedAttempts > prior.sequence.blockedAttempts)) telemetry.guidance('blocked', { taskKey: prior.sequence.taskKey });
    if (e.type === 'user.stepAction' && prior.sequence && prior.sequence.activeIndex !== null && prior.sequence.steps[prior.sequence.activeIndex].entityId === e.entityId) telemetry.guidance('step_done', { taskKey: prior.sequence.taskKey });
    setState(next);
  };
  useEffect(() => { if (dispatchRef) { dispatchRef.current = dispatch; return () => { dispatchRef.current = null; }; } }, [dispatchRef]);

  // Toast expiry: schedule a re-render 2.6 s after a block lands so toastFresh re-evaluates.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!state.sequence?.lastBlocked) return;
    const t = setTimeout(() => forceTick((n) => n + 1), 2600);
    return () => clearTimeout(t);
  }, [state.sequence?.lastBlocked]);

  // Demo driver: play the script once entities exist. StrictMode-safe: `played` is set when
  // the first event FIRES (not when scheduled), and cleanup re-arms only if nothing fired yet.
  // Known limitation (documented): with a live GEMINI key, perception rebuilds `entities`
  // mid-script and truncates the tail — the demo is the no-key proof path.
  const scheduled = useRef(false);
  const played = useRef(false);
  useEffect(() => {
    if (!demo || scheduled.current || entities.filter((e) => e.category !== 'map').length < 3) return;
    scheduled.current = true;
    const timers = buildDemoScript(entities).map(({ at, event }) =>
      setTimeout(() => { played.current = true; dispatch(event); }, at));
    return () => {
      timers.forEach(clearTimeout);
      if (!played.current) scheduled.current = false;
    };
  }, [demo, entities]);

  const byId = (eid: EntityId) => entities.find((e) => e.id === eid);
  const box = (eid: EntityId) => {
    const e = byId(eid);
    if (!e) return null;
    const [ymin, xmin, ymax, xmax] = e.bbox;
    if (ymax - ymin <= 0 || xmax - xmin <= 0) return null; // zero bbox → render nothing
    return { top: pct(ymin), left: pct(xmin), width: pct(xmax - xmin), height: pct(ymax - ymin) };
  };

  const scaffold = visibleScaffold(state);
  const step = activeStep(state);
  const seq = state.sequence;
  const tileIds = entities.filter((e) => e.category !== 'map').map((e) => e.id);
  const blocked = blockedEntityIds(state, tileIds);
  const toastFresh = seq?.lastBlocked && Date.now() - seq.lastBlocked.at < 2500;

  return (
    <div className="absolute inset-0 z-[60] pointer-events-none" data-teaching-layer>
      {/* Ad-hoc highlights: emphasis ON the element (never a detached panel) */}
      {state.highlights.map((h, i) => {
        const b = box(h.entityId);
        return b && (
          <div key={i} className="absolute rounded-xl ring-4 ring-amber-400/80 shadow-[0_0_24px_rgba(251,191,36,0.5)] transition-all" style={b}>
            {h.note && <span className="absolute -top-2 left-2 px-1.5 rounded bg-amber-400 text-[10px] font-bold text-black">{h.note}</span>}
          </div>
        );
      })}

      {/* Relate links: SVG arcs between entity centers, mid-labeled (the EXPERIMENT) */}
      <svg className="absolute inset-0 w-full h-full overflow-visible">
        {state.relations.map((r, i) => {
          const a = byId(r.from), b2 = byId(r.to);
          if (!a || !b2) return null;
          const cx = (e: SceneEntity) => (e.bbox[1] + e.bbox[3]) / 2 / 10;
          const cy = (e: SceneEntity) => (e.bbox[0] + e.bbox[2]) / 2 / 10;
          const mx = (cx(a) + cx(b2)) / 2, my = (cy(a) + cy(b2)) / 2 - 6;
          return (
            <g key={i}>
              <path d={`M ${cx(a)} ${cy(a)} Q ${mx} ${my - 8} ${cx(b2)} ${cy(b2)}`}
                    fill="none" stroke="rgb(99,102,241)" strokeWidth="0.4" strokeDasharray="1.2 0.8"
                    vectorEffect="non-scaling-stroke" transform="scale(1,1)" />
              <text x={`${mx}%`} y={`${my}%`} textAnchor="middle" className="fill-indigo-500 text-[9px] font-mono">{r.label}</text>
            </g>
          );
        })}
      </svg>

      {/* Sequence scaffolding */}
      {seq && step && (
        <>
          {/* soft-block scrim patches over non-target tiles (Carroll: inert + informative) */}
          {scaffold.block && blocked.map((eid) => {
            const b = box(eid);
            return b && (
              <div key={eid} className="absolute rounded-lg bg-slate-900/35 backdrop-saturate-50 pointer-events-auto cursor-not-allowed" style={b}
                   onClick={() => { dispatch({ type: 'user.stepAction', entityId: eid }); }} />
            );
          })}
          {/* active-step catcher + emphasis on the target */}
          {(() => {
            const b = box(step.entityId);
            if (!b) return null;
            const showRing = scaffold.markers || scaffold.highlightOnly;
            return (
              <div className={`absolute rounded-xl pointer-events-auto cursor-pointer ${showRing ? 'ring-4 ring-[var(--accent-color)] shadow-[0_0_28px_rgba(99,102,241,0.45)]' : ''}`}
                   style={b}
                   onClick={() => { dispatch({ type: 'user.stepAction', entityId: step.entityId }); }}>
                {scaffold.markers && seq.activeIndex !== null && (
                  <span className="absolute -top-3 -left-3 w-7 h-7 rounded-full bg-[var(--accent-color)] text-white text-sm font-bold flex items-center justify-center shadow">
                    {seq.activeIndex + 1}
                  </span>
                )}
                {scaffold.labels && (
                  <span className="absolute -bottom-7 left-0 px-2 py-0.5 rounded-md bg-[var(--card-bg)] border border-[var(--card-border)] text-[11px] font-mono whitespace-nowrap shadow-sm">
                    {seq.activeIndex !== null ? seq.activeIndex + 1 : ''} · {step.subgoal} — {step.instruction}
                  </span>
                )}
              </div>
            );
          })()}
          {/* done steps collapse to ✓ dots at their entities (glanceable, no progress bar) */}
          {seq.steps.map((s, i) => {
            if (s.state !== 'done') return null;
            const b = box(s.entityId);
            return b && <span key={i} className="absolute w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center" style={{ top: b.top, left: b.left }}>✓</span>;
          })}
          {/* fade-2 prompt (promptOnly): terse, with the always-available reveal */}
          {scaffold.promptOnly && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--card-bg)] border border-[var(--card-border)] shadow">
              <span className="text-[11px] font-mono">{step.subgoal}</span>
              <button className="text-[10px] font-mono text-[var(--accent-color)]"
                      onClick={() => { dispatch({ type: 'user.reveal' }); }}>show me</button>
            </div>
          )}
          {/* disablement toast (transient, names the active subgoal) */}
          {toastFresh && seq.lastBlocked && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-amber-100 border border-amber-300 text-[11px] font-mono text-amber-900 shadow">
              Not yet — {seq.activeIndex !== null ? `${seq.activeIndex + 1} · ${step.subgoal}` : step.subgoal} first
              {(() => { const e = byId(seq.lastBlocked!.entityId); return e ? ` (that was ${displayName(e)})` : ''; })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
