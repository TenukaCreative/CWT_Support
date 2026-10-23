import { useState } from 'react';
import { apiBlob } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { qs } from './query.js';

// CSV export needs the bearer token, so it is fetched as a blob and saved by the browser.
export function useExportTickets() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (params) => {
    setBusy(true);
    try {
      const blob = await apiBlob(`/tickets/export.csv${qs(params)}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(e.message); // e.g. "too many tickets: narrow your filters"
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}
