async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  dashboard: (params = '') => request(`/api/dashboard${params}`),
  machines: (params = '') => request(`/api/machines${params}`),
  machinesMeta: () => request('/api/machines/meta'),
  machine: (n) => request(`/api/machines/${n}`),
  sheets: () => request('/api/sheets'),
  sheetsCoverage: () => request('/api/sheets/coverage'),
  sheet: (id) => request(`/api/sheets/${id}`),
  uploadSheet: (file, sheetDate) => {
    const form = new FormData();
    form.append('file', file);
    if (sheetDate) form.append('sheet_date', sheetDate);
    return request('/api/sheets/upload', { method: 'POST', body: form });
  },
  patchSheet: (id, body) => request(`/api/sheets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  verifySheet: (id) => request(`/api/sheets/${id}/verify`, { method: 'POST' }),
  deleteSheet: (id) => request(`/api/sheets/${id}`, { method: 'DELETE' }),

  expenses: (params = '') => request(`/api/expenses${params}`),
  addExpense: (body) => request('/api/expenses', { method: 'POST', body: JSON.stringify(body) }),
  deleteExpense: (id) => request(`/api/expenses/${id}`, { method: 'DELETE' }),

  auditLog: (limit = 15) => request(`/api/audit?limit=${limit}`),
  backups: () => request('/api/backups'),
  createBackup: () => request('/api/backups', { method: 'POST' }),
  backupUrl: (name) => `/api/backups/${encodeURIComponent(name)}`,
  exportUrl: (kind, from, to) => (
    kind === 'profit-split'
      ? '/api/export/profit-split.csv'
      : `/api/export/${kind}.csv?from=${from}&to=${to}`
  ),

  authConfig: () => request('/api/auth/config'),
  me: () => request('/api/auth/me'),
  loginLocal: (name, email) => request('/api/auth/local', { method: 'POST', body: JSON.stringify({ name, email }) }),
  loginGoogle: (credential) => request('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  adminUsers: () => request('/api/admin/users'),
  approveUser: (id) => request(`/api/admin/users/${id}/approve`, { method: 'POST' }),
  blockUser: (id) => request(`/api/admin/users/${id}/block`, { method: 'POST' }),
  setUserRole: (id, role) => request(`/api/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role }) }),

  profitSplit: () => request('/api/profit-split'),
  setProfitSplitPaid: (month, paid) =>
    request(`/api/profit-split/${month}`, { method: 'PATCH', body: JSON.stringify({ paid }) }),
  setProfitSplitNotes: (month, notes) =>
    request(`/api/profit-split/${month}`, { method: 'PATCH', body: JSON.stringify({ notes }) }),

  // Every analytics call takes the page's range as a query string. The leaderboard is the
  // deliberate exception — it is all-time by design.
  analyticsByWeekday: (q = '') => request(`/api/analytics/weekday${q}`),
  analyticsByWeekdayMachines: (day, q = '') => request(`/api/analytics/weekday/${day}/machines${q}`),
  analyticsByWeek: (q = '') => request(`/api/analytics/week${q}`),
  analyticsByWeekMachines: (weekStart, q = '') => request(`/api/analytics/week/${weekStart}/machines${q}`),
  analyticsByMonth: (q = '') => request(`/api/analytics/month${q}`),
  analyticsByMonthMachines: (month, q = '') => request(`/api/analytics/month/${month}/machines${q}`),
  analyticsByDayOfMonth: (q = '') => request(`/api/analytics/day-of-month${q}`),
  analyticsByDayOfMonthMachines: (day, q = '') => request(`/api/analytics/day-of-month/${day}/machines${q}`),
  analyticsByPayPeriod: (q = '') => request(`/api/analytics/pay-period${q}`),
  analyticsByPayPeriodMachines: (period, q = '') => request(`/api/analytics/pay-period/${period}/machines${q}`),
  analyticsWeekendSplit: (q = '') => request(`/api/analytics/weekend-split${q}`),
  analyticsWeekendSplitMachines: (key, q = '') => request(`/api/analytics/weekend-split/${key}/machines${q}`),
  analyticsOverview: (q = '') => request(`/api/analytics/overview${q}`),
  analyticsLeaderboard: () => request('/api/analytics/leaderboard'),
  analyticsTrend: (q = '') => request(`/api/analytics/trend${q}`),
};

export const fmt = (n, opts = {}) =>
  n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0, ...opts });

export const money = (n) => (n == null ? '—' : `$${fmt(Math.abs(n))}`);

export const signedMoney = (n) => {
  if (n == null) return '—';
  return n < 0 ? `-$${fmt(Math.abs(n))}` : `$${fmt(n)}`;
};
