/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Shield, ShieldCheck, RotateCcw, X } from 'lucide-react';
import type { ProviderKind } from '../voice/types';
import type { Autonomy } from '../scenarios';
import { AUTONOMY_OPTIONS } from '../scenarios';
import type { FeedbackMode } from '../feedback';
import { FEEDBACK_OPTIONS } from '../feedback';
import { EARCON_KINDS, playEarcon } from '../feedback/earcons';
import { telemetry, detectDevice } from '../telemetry';

type DrawerProps = {
  open: boolean; onClose: () => void;
  honestMode: boolean; onHonestMode: (v: boolean) => void;
  voiceBackend: ProviderKind; onVoiceBackend: (v: ProviderKind) => void;
  autonomy: Autonomy; onAutonomy: (v: Autonomy) => void;
  feedbackMode: FeedbackMode; onFeedbackMode: (v: FeedbackMode) => void;
  sendFrequency: number; onSendFrequency: (v: number) => void;
  worldState: string;
  undoCount: number; onUndo: () => void;
  onEndSession: () => void; onReset: () => void; isLive: boolean;
  logs: { time: string; type: string; message: string }[];
  isEmbedded: boolean;
};

export function DebugDrawer(props: DrawerProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!props.open) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [props.open]);

  void tick; // re-read on tick

  const device = detectDevice();
  const tm = telemetry.metrics();
  const cal = tm.deixis.calibration;

  return (
    <>
      {props.open && <div className="fixed inset-0 z-[39]" onClick={props.onClose} />}
      <div className={`fixed right-0 top-9 bottom-0 w-[360px] z-40 flex flex-col bg-[var(--card-bg)] border-l border-[var(--card-border)] shadow-2xl overflow-y-auto custom-scrollbar transition-transform duration-300 ${props.open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-4 border-b border-[var(--card-border)] flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Debug</span>
          <button onClick={props.onClose} className="p-1 rounded-lg hover:bg-[var(--bg-color)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">

          {/* 1. Honest-mode toggle */}
          <button
            onClick={() => props.onHonestMode(!props.honestMode)}
            title={props.honestMode
              ? "Honest mode ON — carries confidence, asks when a photo is ambiguous"
              : "Confident baseline — treats every hint as absolute truth (Google default)"}
            className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border transition-all ${
              props.honestMode
                ? 'bg-green-500/10 border-green-500/40'
                : 'bg-[var(--inner-box-bg)] border-[var(--card-border)] hover:border-[var(--accent-color)]'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {props.honestMode
                ? <ShieldCheck size={18} className="text-green-500 shrink-0" />
                : <Shield size={18} className="text-[var(--text-secondary)] shrink-0" />}
              <div className="flex flex-col items-start min-w-0">
                <span className="text-[12px] font-bold text-[var(--text-primary)] leading-tight">Honest mode</span>
                <span className="text-[10px] font-mono text-[var(--text-secondary)] leading-tight truncate">
                  {props.honestMode ? 'Asks when unsure' : 'Confident (Google baseline)'}
                </span>
              </div>
            </div>
            <div className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${props.honestMode ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
              <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${props.honestMode ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
          </button>

          {/* 2. Voice backend select */}
          <div className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
            <span className="text-[12px] font-bold text-[var(--text-primary)]">Voice backend</span>
            <select
              value={props.voiceBackend}
              onChange={(e) => props.onVoiceBackend(e.target.value as ProviderKind)}
              className="text-[12px] font-mono bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-2 py-1 text-[var(--text-primary)]"
            >
              <option value="gemini">Gemini</option>
              <option value="azure">RTV2 (Azure Realtime)</option>
            </select>
          </div>

          {/* 3. Autonomy select */}
          <div className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
            <span className="text-[12px] font-bold text-[var(--text-primary)]" title="How readily actions commit vs. ask you to confirm first">Autonomy</span>
            <select
              value={props.autonomy}
              onChange={(e) => props.onAutonomy(e.target.value as Autonomy)}
              className="text-[12px] font-mono bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-2 py-1 text-[var(--text-primary)]"
            >
              {AUTONOMY_OPTIONS.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* 4. Feedback select */}
          <div className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
            <span className="text-[12px] font-bold text-[var(--text-primary)]" title="How the app confirms actions — the assistant stays silent on success">Feedback</span>
            <select
              value={props.feedbackMode}
              onChange={(e) => props.onFeedbackMode(e.target.value as FeedbackMode)}
              className="text-[12px] font-mono bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-2 py-1 text-[var(--text-primary)]"
            >
              {FEEDBACK_OPTIONS.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* 5. Earcon audition buttons */}
          <div className="w-full px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
            <span className="text-[11px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Audition earcons</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EARCON_KINDS.map(kind => (
                <button
                  key={kind}
                  onClick={() => playEarcon(kind)}
                  className="px-2 py-1 rounded-md text-[10px] font-mono border bg-[var(--card-bg)] border-[var(--card-border)] text-[var(--text-primary)] hover:border-[#0077F0] hover:text-[#0077F0] dark:hover:text-white transition-colors active:scale-95"
                  title={`Play "${kind}" earcon`}
                >
                  {kind.replace('commit-', '')}
                </button>
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
            <button
              onClick={() => telemetry.exportJSON()}
              className="mt-2 w-full px-2 py-1 rounded-md text-[11px] font-mono border bg-[var(--card-bg)] border-[var(--card-border)] text-[var(--text-primary)] hover:border-[#0077F0] hover:text-[#0077F0] dark:hover:text-white transition-colors active:scale-95"
            >
              Export session JSON
            </button>
          </div>

          {/* 7. Refresh-rate slider */}
          <section className="flex items-center gap-4 pt-2">
            <div className="flex-1 space-y-2">
              <div className="flex justify-between text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                <span>Refresh Rate</span>
                <span>{props.sendFrequency}ms</span>
              </div>
              <input
                type="range"
                min="300"
                max="2000"
                step="100"
                value={props.sendFrequency}
                onChange={e => props.onSendFrequency(Number(e.target.value))}
                className="w-full h-1 bg-black/5 rounded-full accent-[var(--accent-color)] appearance-none cursor-pointer"
              />
            </div>
          </section>

          {/* 8. Embedded-preview warning */}
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

          {/* 9. End Session / Reset buttons (isLive only) */}
          {props.isLive && (
            <div className="flex gap-2">
              <button
                onClick={props.onEndSession}
                className="flex-1 h-[60px] rounded-full font-dm font-bold text-[15px] tracking-[-0.025em] leading-[28px] transition-all shadow-lg bg-[var(--inverse-bg)] text-[var(--inverse-text)] hover:opacity-90 hover:scale-[1.02] active:scale-98 flex items-center justify-center gap-3"
              >
                End Session
              </button>
              <button
                onClick={props.onReset}
                className="flex-1 h-[60px] rounded-full font-dm font-bold text-[15px] tracking-[-0.025em] leading-[28px] transition-all flex items-center justify-center active:scale-95 border bg-[var(--card-bg)] border-[var(--card-border)] dark:border-[#495564] text-[var(--text-primary)] hover:bg-[#E7F0FF] hover:border-[#0077F0] hover:text-[#0077F0] dark:hover:bg-[#344256] dark:hover:border-[#0076F0] dark:hover:text-white"
              >
                <RotateCcw size={18} className="mr-2" /> Reset
              </button>
            </div>
          )}

          {/* 10. World state + Undo button */}
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

          {/* 11. Operation Stream log list */}
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
      </div>
    </>
  );
}
