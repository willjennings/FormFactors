// Feed registry (spec §8): the fixed set of live/simulated data sources a widget artifact's
// fields may bind to. Descriptors are pure and testable — every read() takes an injected `now`
// so tests never depend on wall-clock time. weather.read is the ONLY impure descriptor (does a
// real fetch); its failure mode is a typed FeedUnavailable the renderer maps to "feed
// unavailable", never a stale value silently passed off as fresh.
import type { FeedId } from './types';

export interface FeedDescriptor {
  id: FeedId;
  label: string;
  provenance: 'live' | 'simulated';
  refreshMs: number;
  read(now: number): Promise<string> | string;
}

export class FeedUnavailable extends Error {
  feedId: FeedId;
  constructor(feedId: FeedId, cause?: unknown) {
    super(`feed unavailable: ${feedId}`);
    this.name = 'FeedUnavailable';
    this.feedId = feedId;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

function readClock(now: number): string {
  return new Date(now).toLocaleTimeString();
}

// Deterministic simulated walk in `now` — SIMULATED, never claimed as a real market feed
// (spec §8, and see the prompt's combine section: "the stock feed is SIMULATED").
function readStock(now: number): string {
  const value = 42 + 6 * Math.sin(now / 300000) + ((now / 5000 | 0) % 7) * 0.13;
  return `MERI $${value.toFixed(2)}`;
}

async function readWeather(_now: number): Promise<string> {
  try {
    const res = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m,weather_code',
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const temp = data?.current?.temperature_2m;
    if (typeof temp !== 'number') throw new Error('malformed open-meteo response');
    return `${Math.round(temp)}°C`;
  } catch (err) {
    throw new FeedUnavailable('weather', err);
  }
}

export const FEEDS: Record<FeedId, FeedDescriptor> = {
  clock: { id: 'clock', label: 'Clock', provenance: 'live', refreshMs: 1000, read: readClock },
  weather: { id: 'weather', label: 'Weather', provenance: 'live', refreshMs: 600000, read: readWeather },
  stock: { id: 'stock', label: 'MERI', provenance: 'simulated', refreshMs: 5000, read: readStock },
};
