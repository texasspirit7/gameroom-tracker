const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayISO = () => toISO(new Date());

export const addDays = (iso, delta) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + delta);
  return toISO(d);
};

const startOfWeek = (iso) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
};

const startOfMonth = (iso) => {
  const d = parseISO(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

const startOfYear = (iso) => `${parseISO(iso).getFullYear()}-01-01`;

const formatShort = (iso) => {
  const d = parseISO(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

export function formatRangeLabel(from, to) {
  const fd = parseISO(from);
  const td = parseISO(to);
  if (from === to) return `${MONTHS[fd.getMonth()]} ${fd.getDate()}, ${fd.getFullYear()}`;
  if (fd.getFullYear() === td.getFullYear()) {
    if (fd.getMonth() === td.getMonth()) return `${MONTHS[fd.getMonth()]} ${fd.getDate()}–${td.getDate()}, ${fd.getFullYear()}`;
    return `${formatShort(from)} – ${formatShort(to)}, ${fd.getFullYear()}`;
  }
  return `${formatShort(from)}, ${fd.getFullYear()} – ${formatShort(to)}, ${td.getFullYear()}`;
}

export function buildPresets() {
  const today = todayISO();
  const yesterday = addDays(today, -1);
  const wtdFrom = startOfWeek(today);
  const lastWeekTo = addDays(wtdFrom, -1);
  const lastWeekFrom = addDays(lastWeekTo, -6);
  const mtdFrom = startOfMonth(today);
  const lastMonthTo = addDays(mtdFrom, -1);
  const lastMonthFrom = startOfMonth(lastMonthTo);
  const ytdFrom = startOfYear(today);

  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: yesterday, to: yesterday },
    { key: 'last7', label: 'Last 7 Days', from: addDays(today, -6), to: today },
    { key: 'wtd', label: 'This Week', from: wtdFrom, to: today },
    { key: 'lastWeek', label: 'Last Week', from: lastWeekFrom, to: lastWeekTo },
    { key: 'mtd', label: 'This Month', from: mtdFrom, to: today },
    { key: 'lastMonth', label: 'Last Month', from: lastMonthFrom, to: lastMonthTo },
    { key: 'last30', label: 'Last 30 Days', from: addDays(today, -29), to: today },
    { key: 'ytd', label: 'Year to Date', from: ytdFrom, to: today },
    { key: 'allTime', label: 'All Time', from: null, to: null },
  ];
}
