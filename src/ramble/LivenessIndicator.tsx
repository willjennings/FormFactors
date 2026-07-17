import type { SessionState } from './types';
import { isStalled } from './selectors';

const DOT: Record<string, string> = {
  listening: 'bg-emerald-500', filling: 'bg-blue-500', asking: 'bg-amber-400',
  thinking: 'bg-blue-400', readingBack: 'bg-violet-500', idle: 'bg-slate-400', stalled: 'bg-red-500',
};

export function LivenessIndicator({ state, now, live = true }: { state: SessionState; now: number; live?: boolean }) {
  if (!live) {
    // No session (never started, or after Stop): show a calm "off", never "stalled" —
    // mirrors the main app's MenuBar "off — nothing sent" precedent (§ honesty: don't
    // alarm about a dead session).
    return (
      <div className="flex items-center gap-2 text-xs font-mono">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-400 opacity-40" />
        <span className="text-slate-400">off</span>
      </div>
    );
  }
  const stalled = isStalled(state, now);
  const activity = stalled ? 'stalled' : state.activity;
  const secs = Math.round((now - state.lastUpdateAt) / 1000);
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT[activity] ?? 'bg-slate-400'} ${activity === 'filling' || activity === 'asking' ? 'animate-pulse' : ''}`} />
      <span className={stalled ? 'text-red-600 font-semibold' : 'text-slate-500'}>
        {stalled ? `no update ${secs}s` : activity}
      </span>
    </div>
  );
}
