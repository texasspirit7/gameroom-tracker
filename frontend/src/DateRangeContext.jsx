import { createContext, useContext, useMemo, useState } from 'react';
import { buildPresets, formatRangeLabel } from './dateRange.js';

const DateRangeContext = createContext(null);

/**
 * Every page opens on the current Monday-to-Sunday week, matching the period the profit
 * split now settles on.
 *
 * The selection deliberately isn't persisted: a change lasts for the session and is dropped on
 * refresh or a fresh sign-in, so you always start from the same known window rather than
 * inheriting a range you set days ago and forgot about.
 */
export const DEFAULT_RANGE_KEY = 'wtd';

/** Left over from when the selection was persisted — cleared so it can't resurface later. */
const LEGACY_STORAGE_KEY = 'grt_date_range';
try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* private mode / storage disabled */ }

function initialRange(presets, key) {
  const p = presets.find((x) => x.key === key) || presets.find((x) => x.key === 'allTime');
  return { preset: p.key, from: p.from, to: p.to, label: p.label };
}

export function DateRangeProvider({ children }) {
  const presets = useMemo(() => buildPresets(), []);
  const [state, setState] = useState(() => initialRange(presets, DEFAULT_RANGE_KEY));

  const setPreset = (key) => {
    const p = presets.find((x) => x.key === key);
    if (!p) return;
    setState({ preset: p.key, from: p.from, to: p.to, label: p.label });
  };

  const setCustomRange = (from, to) => {
    if (!from || !to || from > to) return;
    setState({ preset: 'custom', from, to, label: formatRangeLabel(from, to) });
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
 * context, but its own state and not inherited from it.
 *
 * Analytics uses this so changing the range there doesn't follow you to the Dashboard, and
 * vice versa. Like the shared range it starts on the current month and resets on refresh.
 */
export function useLocalDateRange(defaultKey = DEFAULT_RANGE_KEY) {
  const presets = useMemo(() => buildPresets(), []);
  const [state, setState] = useState(() => initialRange(presets, defaultKey));

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
