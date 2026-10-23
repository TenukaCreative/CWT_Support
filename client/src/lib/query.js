import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ?a=1&b=2 from an object, dropping empty values.
export const qs = (params = {}) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// keepPreviousData: the table stays on screen while the next page/filter loads (no flicker).
export const useList = (key, path, params) =>
  useQuery({
    queryKey: [key, params],
    queryFn: () => api(`${path}${qs(params)}`),
    placeholderData: keepPreviousData,
  });

export const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';
