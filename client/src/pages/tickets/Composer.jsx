import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import { validateFiles } from '../../lib/tickets.js';
import Alert from '../../components/Alert.jsx';
import FileInput from '../../components/FileInput.jsx';

// Reply box. Staff get a second mode for internal notes and a canned-reply picker.
export default function Composer({ ticket }) {
  const { user } = useAuth();
  const staff = user.role !== 'CUSTOMER';
  const [mode, setMode] = useState('PUBLIC');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const canned = useQuery({
    queryKey: ['canned-replies'],
    queryFn: () => api('/canned-replies'),
    enabled: staff,
  });

  const send = useAdminMutation(
    () => {
      const form = new FormData();
      form.set('body', body.trim());
      form.set('type', mode);
      files.forEach((f) => form.append('files', f));
      return api(`/tickets/${ticket.id}/messages`, { method: 'POST', body: form });
    },
    {
      invalidate: ['ticket', 'tickets'],
      success: mode === 'PUBLIC' ? 'Reply sent' : 'Note added',
      onSuccess: () => {
        setBody('');
        setFiles([]);
      },
    },
  );

  const isNote = mode === 'INTERNAL_NOTE';
  const blocked = !isNote && !ticket.canReply;
  if (blocked && !staff) {
    return ticket.status === 'CLOSED' ? <Alert type="info">This ticket is closed.</Alert> : null; // resolved: the page explains how to reopen
  }

  const submit = (e) => {
    e.preventDefault();
    const problem = validateFiles(files);
    if (problem) return setFileError(problem);
    if (body.trim()) send.mutate();
  };
  const insertCanned = (e) => {
    const reply = canned.data?.replies.find((r) => r.id === e.target.value);
    if (reply) setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${reply.body}` : reply.body));
    e.target.value = '';
  };

  return (
    <form
      onSubmit={submit}
      className={`card space-y-3 ${isNote ? 'border-amber-300 bg-amber-50' : ''}`}
      aria-label="Reply"
    >
      {staff && (
        <div role="tablist" aria-label="Reply type" className="flex gap-1">
          {[
            ['PUBLIC', 'Reply to customer'],
            ['INTERNAL_NOTE', 'Internal note'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={`rounded-md px-3 py-1.5 text-sm ${mode === key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {blocked && staff && (
        <Alert type="info">This ticket is closed. You can still add internal notes.</Alert>
      )}
      {isNote && (
        <p className="text-xs text-amber-900">
          Only staff can see internal notes. The customer is never notified.
        </p>
      )}

      {!blocked && (
        <>
          <div>
            <label htmlFor="reply-body" className="sr-only">
              {isNote ? 'Internal note' : 'Your reply'}
            </label>
            <textarea
              id="reply-body"
              rows={5}
              className="input"
              placeholder={isNote ? 'Write an internal note…' : 'Write your reply…'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={10000}
            />
          </div>
          {staff && !isNote && canned.data?.replies.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span>Canned reply</span>
              <select className="input w-64" defaultValue="" onChange={insertCanned}>
                <option value="">Insert…</option>
                {canned.data.replies.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <FileInput files={files} onChange={setFiles} error={fileError} onError={setFileError} />
          <button type="submit" className="btn-primary" disabled={!body.trim() || send.isPending}>
            {send.isPending ? 'Sending…' : isNote ? 'Add note' : 'Send reply'}
          </button>
        </>
      )}
    </form>
  );
}
