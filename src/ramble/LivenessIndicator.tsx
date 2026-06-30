import type { SessionState } from './types';
import { isStalled } from './selectors';

const DOT: Record<string, string> = {
  listening: 'bg-emerald-500', filling: 'bg-blue-500', asking: 'bg-amber-400',
  thinking: 'bg-blue-400', readingBack: 'bg-violet-500', idle: 'bg-slate-400', stalled: 'bg-red-500',
};

export function LivenessIndicator({ state, now }: { state: SessionState; now: number }) {
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
