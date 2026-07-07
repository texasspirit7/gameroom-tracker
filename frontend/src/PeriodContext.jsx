import { createContext, useContext, useState } from 'react';

const PeriodContext = createContext(null);

export const PERIODS = [
  ['day', 'Daily'],
  ['week', 'Weekly'],
  ['month', 'Monthly'],
  ['all', 'All time'],
];

const VALID = new Set(PERIODS.map(([key]) => key));

export function PeriodProvider({ children }) {
  const [period, setPeriodState] = useState(() => {
    const saved = localStorage.getItem('grt_period');
    return VALID.has(saved) ? saved : 'day';
  });

  const setPeriod = (p) => {
    if (!VALID.has(p)) return;
    localStorage.setItem('grt_period', p);
    setPeriodState(p);
  };

  return <PeriodContext.Provider value={{ period, setPeriod }}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod must be used inside PeriodProvider');
  return ctx;
}
