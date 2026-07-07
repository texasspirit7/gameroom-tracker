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
  machine: (n) => request(`/api/machines/${n}`),
  sheets: () => request('/api/sheets'),
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
};

export const fmt = (n, opts = {}) =>
  n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0, ...opts });

export const money = (n) => (n == null ? '—' : `$${fmt(Math.abs(n))}`);

export const signedMoney = (n) => {
  if (n == null) return '—';
  return n < 0 ? `-$${fmt(Math.abs(n))}` : `$${fmt(n)}`;
};
