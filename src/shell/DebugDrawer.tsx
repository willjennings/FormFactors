/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ProviderKind } from '../voice/types';
import type { Autonomy } from '../scenarios';
import { AUTONOMY_OPTIONS } from '../scenarios';
import type { FeedbackMode } from '../feedback';
import { FEEDBACK_OPTIONS } from '../feedback';
import { EARCON_KINDS, playEarcon } from '../feedback/earcons';
import { telemetry, detectDevice } from '../telemetry';
import { Switch } from '../ui/Switch';
import { Select } from '../ui/Select';
import { Slider } from '../ui/Slider';
import { Button } from '../ui/Button';

const VOICE_BACKEND_OPTIONS = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'azure', label: 'RTV2 (Azure Realtime)' },
];

type DrawerProps = {
  honestMode: boolean; onHonestMode: (v: boolean) => void;
  voiceBackend: ProviderKind; onVoiceBackend: (v: ProviderKind) => void;
  autonomy: Autonomy; onAutonomy: (v: Autonomy) => void;
  feedbackMode: FeedbackMode; onFeedbackMode: (v: FeedbackMode) => void;
  sendFrequency: number; onSendFrequency: (v: number) => void;
  showMarkings: boolean; onShowMarkings: (v: boolean) => void;
  worldState: string;
  undoCount: number; onUndo: () => void;
  onEndSession: () => void; onReset: () => void; isLive: boolean;
  logs: { time: string; type: string; message: string }[];
  isEmbedded: boolean;
};

export function DebugDrawer(props: DrawerProps) {
  const [tick, setTick] = useState(0);

  // Runs only while the drawer is mounted: Radix Dialog unmounts Portal content on close, so the interval's cleanup fires then (no open-guard needed).
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  void tick; // re-read on tick

  const device = detectDevice();
  const tm = telemetry.metrics();
  const cal = tm.deixis.calibration;

  return (
    <div className="flex flex-col gap-4">

      {/* 1. Honest-mode toggle */}
      <Switch
        label="Honest mode"
        hint={props.honestMode ? 'Asks when unsure' : 'Confident (Google baseline)'}
        checked={props.honestMode}
        onCheckedChange={props.onHonestMode}
      />

      {/* 2. Voice backend select */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Voice backend</span>
        <Select
          value={props.voiceBackend}
          onValueChange={(v) => props.onVoiceBackend(v as ProviderKind)}
          options={VOICE_BACKEND_OPTIONS}
          ariaLabel="Voice backend"
        />
      </div>

      {/* 3. Autonomy select */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]" title="How readily actions commit vs. ask you to confirm first">Autonomy</span>
        <Select
          value={props.autonomy}
          onValueChange={(v) => props.onAutonomy(v as Autonomy)}
          options={AUTONOMY_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
          ariaLabel="Autonomy"
        />
      </div>

      {/* 4. Feedback select */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]" title="How the app confirms actions — the assistant stays silent on success">Feedback</span>
        <Select
          value={props.feedbackMode}
          onValueChange={(v) => props.onFeedbackMode(v as FeedbackMode)}
          options={FEEDBACK_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
          ariaLabel="Feedback mode"
        />
      </div>

      {/* 5. Earcon audition buttons */}
      <div className="w-full px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
        <span className="text-[11px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Audition earcons</span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EARCON_KINDS.map(kind => (
            <Button
              key={kind}
              size="sm"
              onClick={() => playEarcon(kind)}
              title={`Play "${kind}" earcon`}
            >
              {kind.replace('commit-', '')}
            </Button>
          ))}
        </div>
      </div>

      {/* 6. Testbed telemetry block + Export JSON */}
      <div className="w-full px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Testbed</span>
          <span className="text-[10px] font-mono text-[var(--text-secondary)]">{device.formFactor} · {device.width}×{device.height} · {device.pointer}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono text-[var(--text-primary)]">
          <span className="text-[var(--text-secondary)]">Deixis acc</span>
          <span>{tm.deixis.accuracy === null ? '—' : `${Math.round(tm.deixis.accuracy * 100)}% (${tm.deixis.correct}/${tm.deixis.graded})`}</span>
          <span className="text-[var(--text-secondary)]">Calibration</span>
          <span>hi {cal.high.correct}/{cal.high.n} · lo {cal.low.correct}/{cal.low.n}</span>
          <span className="text-[var(--text-secondary)]">Actions</span>
          <span>{tm.actions.total} ({tm.actions.commits}✓ {tm.actions.witnesses}?)</span>
          <span className="text-[var(--text-secondary)]">Grounding</span>
          <span>{tm.grounding.agreementRate === null ? '—' : `${Math.round(tm.grounding.agreementRate * 100)}% (${tm.grounding.agree}/${tm.grounding.total})`}</span>
          <span className="text-[var(--text-secondary)]">Corrections</span>
          <span>{tm.corrections} ({Math.round(tm.correctionRate * 100)}%)</span>
          <span className="text-[var(--text-secondary)]">Errors</span>
          <span>{tm.errors}</span>
        </div>
        <Button
          size="sm"
          className="mt-2 w-full"
          onClick={() => telemetry.exportJSON()}
        >
          Export session JSON
        </Button>
      </div>

      {/* 7. Refresh-rate slider */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[8px] font-bold text-slate-400 uppercase tracking-widest">
          <span>Refresh Rate</span>
          <span>{props.sendFrequency}ms</span>
        </div>
        <Slider
          value={props.sendFrequency}
          onValueChange={props.onSendFrequency}
          min={300}
          max={2000}
          step={100}
          ariaLabel="Refresh rate"
        />
      </div>

      {/* 8. Debug markings toggle (spec §7) */}
      <Switch
        label="Debug markings"
        hint="highlight rings + legend"
        checked={props.showMarkings}
        onCheckedChange={props.onShowMarkings}
      />

      {/* 9. Embedded-preview warning */}
      {props.isEmbedded && !props.isLive && (
        <div className="w-full px-4 py-3 rounded-2xl border border-amber-500/40 bg-amber-500/5">
          <p className="text-[11px] font-mono text-[var(--text-secondary)] leading-relaxed mb-2">
            Running in an embedded preview — the microphone is usually blocked here. Open in a full tab to grant mic access.
          </p>
          <button
            onClick={() => window.open(window.location.href, '_blank', 'noopener')}
            className="w-full h-[40px] rounded-full font-dm font-bold text-[12px] flex items-center justify-center gap-2 border border-amber-500/60 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            Open in a new tab ↗
          </button>
        </div>
      )}

      {/* 10. End Session / Reset buttons (isLive only) */}
      {props.isLive && (
        <div className="flex gap-2">
          <Button
            variant="primary"
            className="flex-1 h-11 rounded-full font-bold"
            onClick={props.onEndSession}
          >
            End Session
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-11 rounded-full font-bold"
            onClick={props.onReset}
          >
            <RotateCcw size={18} className="mr-2" /> Reset
          </Button>
        </div>
      )}

      {/* 11. World state + Undo button */}
      <section className="shrink-0 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6">
        <div className="flex items-center justify-end mb-2 -mt-2">
          <button
            onClick={props.onUndo}
            disabled={props.undoCount === 0}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
              props.undoCount === 0
                ? 'opacity-40 cursor-not-allowed border-[var(--card-border)] text-[var(--text-secondary)]'
                : 'border-[var(--card-border)] text-[var(--text-primary)] hover:border-[#0077F0] hover:text-[#0077F0] dark:hover:text-white active:scale-95'
            }`}
            title="Undo the last document change"
          >
            <RotateCcw size={13} /> Undo{props.undoCount ? ` (${props.undoCount})` : ''}
          </button>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)] mb-1.5">World state (as the model reads it)</div>
        <div className="text-[11px] font-mono text-[var(--text-primary)] break-words leading-relaxed">{props.worldState}</div>
      </section>

      {/* 12. Operation Stream log list */}
      <section className="flex-1 min-h-[200px] bg-[var(--bg-color)] rounded-2xl p-6 border border-[var(--card-border)] flex flex-col overflow-hidden">
        <span className="text-[9px] font-black uppercase text-slate-400 mb-4 tracking-widest">Operation Stream</span>
        <div className="flex-1 font-mono text-[9px] space-y-3 overflow-y-auto custom-scrollbar pr-2">
          {props.logs.map((l, i) => (
            <div key={i} className="flex flex-col gap-1 border-b border-black/5 pb-2">
              <div className="flex justify-between items-center opacity-40">
                <span>{l.time}</span>
                <span className="uppercase text-[7px]">{l.type}</span>
              </div>
              <span className={l.type === 'gemini' ? 'text-[var(--accent-color)]' : 'text-[var(--text-secondary)]'}>{l.message}</span>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
