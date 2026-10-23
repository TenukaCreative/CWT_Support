import { useState } from 'react';
import { apiBlob } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { fmtBytes } from '../lib/tickets.js';

// Files are served only through the authenticated, scoped endpoint, so the bearer token is needed:
// fetch as a blob and hand it to the browser as a download.
export default function AttachmentList({ attachments }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  if (!attachments?.length) return null;

  const download = async (a) => {
    setBusy(a.id);
    try {
      const blob = await apiBlob(`/attachments/${a.id}/download`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attachments">
      {attachments.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            disabled={busy === a.id}
            onClick={() => download(a)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
            aria-label={`Download ${a.filename}`}
          >
            📎 {a.filename} <span className="text-slate-500">({fmtBytes(a.size)})</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
