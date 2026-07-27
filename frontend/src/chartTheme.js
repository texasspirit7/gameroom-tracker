/**
 * Chart colours for the dark felt ground.
 *
 * Kept in one place so the series palette can't drift page to page, and so axis/grid chrome
 * stays in step with the CSS hairlines. Recharts takes plain strings rather than CSS custom
 * properties for SVG strokes and fills, so these mirror the tokens in App.css by hand — if you
 * change a colour there, change it here too.
 */

export const CHART = {
  grid: '#24332c',   // --line
  axis: '#74897f',   // --muted
  zero: '#3a4b43',
  good: '#46d98a',   // --good
  bad: '#ff6b6b',    // --bad
  accent: '#c9a227', // --accent

  // The six dashboard metrics. Chosen to stay distinguishable against near-black without
  // any of them competing with brass, which is reserved for interface accent.
  totalIn: '#4a9fd8',
  totalOut: '#7f9ba8',
  match: '#b57ce0',
  expenses: '#f0b429',
  meterProfit: '#46d98a',
  netProfit: '#3fc7c7',

  // Paired in/out bars
  in: '#4a9fd8',
  out: '#c98a8a',
};

/** Spread onto <XAxis>/<YAxis> so ticks and axis lines read as chrome, not content. */
export const axisProps = {
  fontSize: 12,
  stroke: CHART.grid,
  tick: { fill: CHART.axis },
};

/** Spread onto <Tooltip> — the recharts default is a white card, which breaks on this ground. */
export const tooltipProps = {
  contentStyle: {
    background: '#0e1613',
    border: '1px solid #24332c',
    borderRadius: 4,
    color: '#eaf2ee',
    fontSize: 12,
  },
  labelStyle: { color: '#74897f' },
  itemStyle: { color: '#eaf2ee' },
  cursor: { fill: 'rgba(201,162,39,0.07)', stroke: CHART.grid },
};
