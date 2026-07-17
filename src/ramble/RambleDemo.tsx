import { useEffect, useRef, useState } from 'react';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';
import { reduce } from './sessionStore';
import { SCRIPTED_DEMO } from './scriptedDemo';
import type { SessionState } from './types';
import { Monitor } from './Monitor';

export function RambleDemo() {
  const [state, setState] = useState<SessionState>(() => initialSessionState(RFI_SCHEMA, '6/29/2026', Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const step = useRef(0);

  // Tick "now" so the liveness/stall readout is live.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // Play the scripted sequence, one event every 1.2s.
  useEffect(() => {
    const t = setInterval(() => {
      if (step.current >= SCRIPTED_DEMO.length) { clearInterval(t); return; }
      const ev = SCRIPTED_DEMO[step.current++];
      setState((s) => reduce(s, ev, Date.now()));
    }, 1200);
    return () => clearInterval(t);
  }, []);

  return (
    <Monitor
      schema={RFI_SCHEMA} state={state} now={now}
      onEditStart={(id) => setState((s) => reduce(s, { type: 'user.editStart', slotId: id }, Date.now()))}
      onEditCommit={(id, value) => setState((s) => reduce(s, { type: 'user.editCommit', slotId: id, value }, Date.now()))}
      onEditCancel={(id) => setState((s) => reduce(s, { type: 'user.editCancel', slotId: id }, Date.now()))}
      onOpenFullEditor={() => { /* Plan 2: navigate to the edit pass */ }}
    />
  );
}
