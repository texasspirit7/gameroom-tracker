import { createContext, useContext, useMemo, useState } from 'react';
import { buildPresets, formatRangeLabel } from './dateRange.js';

const DateRangeContext = createContext(null);
const STORAGE_KEY = 'grt_date_range';

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function DateRangeProvider({ children }) {
  const presets = useMemo(() => buildPresets(), []);

  const [state, setState] = useState(() => {
    const saved = loadSaved();
    if (saved?.preset === 'custom' && saved.from && saved.to) {
      return { preset: 'custom', from: saved.from, to: saved.to, label: formatRangeLabel(saved.from, saved.to) };
    }
    const found = presets.find((p) => p.key === saved?.preset) || presets.find((p) => p.key === 'allTime');
    return { preset: found.key, from: found.from, to: found.to, label: found.label };
  });

  const setPreset = (key) => {
    const p = presets.find((x) => x.key === key);
    if (!p) return;
    const next = { preset: p.key, from: p.from, to: p.to, label: p.label };
    setState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const setCustomRange = (from, to) => {
    if (!from || !to || from > to) return;
    const next = { preset: 'custom', from, to, label: formatRangeLabel(from, to) };
    setState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return (
    <DateRangeContext.Provider value={{ ...state, presets, setPreset, setCustomRange }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error('useDateRange must be used inside DateRangeProvider');
  return ctx;
}

/**
 * A range that belongs to one page rather than the whole app: same shape as the shared
 * context, but its own state, not persisted and not inherited.
 *
 * Analytics uses this so it always opens on All Time. Sharing the global range would mean
 * picking "This Month" on the Dashboard silently narrowed the trends and seasonality
 * breakdowns too, which are long-horizon views by nature.
 */
export function useLocalDateRange(defaultKey = 'allTime') {
  const presets = useMemo(() => buildPresets(), []);
  const [state, setState] = useState(() => {
    const p = presets.find((x) => x.key === defaultKey) || presets.find((x) => x.key === 'allTime');
    return { preset: p.key, from: p.from, to: p.to, label: p.label };
  });

  const setPreset = (key) => {
    const p = presets.find((x) => x.key === key);
    if (p) setState({ preset: p.key, from: p.from, to: p.to, label: p.label });
  };

  const setCustomRange = (from, to) => {
    if (!from || !to || from > to) return;
    setState({ preset: 'custom', from, to, label: formatRangeLabel(from, to) });
  };

  return { ...state, presets, setPreset, setCustomRange };
}
