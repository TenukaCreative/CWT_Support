import { useEffect, useId, useRef } from 'react';
import Alert from './Alert.jsx';

// Native <dialog>: the browser provides the focus trap, Esc-to-close and aria-modal semantics.
export function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-full rounded-lg p-0 shadow-xl backdrop:bg-slate-900/40 ${wide ? 'max-w-2xl' : 'max-w-md'}`}
    >
      <div className="p-6">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}

// Replaces window.confirm (inaccessible, unstyleable, blocked in some contexts).
export function ConfirmDialog({
  title,
  children,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="text-sm text-slate-700">{children}</div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={
            danger
              ? 'btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-60'
              : 'btn-primary'
          }
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

const BADGE = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  DEACTIVATED: 'bg-slate-200 text-slate-700',
  ARCHIVED: 'bg-slate-200 text-slate-700',
  ADMIN: 'bg-purple-100 text-purple-800',
  SUPPORT: 'bg-sky-100 text-sky-800',
  CUSTOMER: 'bg-slate-100 text-slate-700',
};
export const Badge = ({ value, label }) => (
  <span
    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[value] ?? BADGE.CUSTOMER}`}
  >
    {label ?? value.charAt(0) + value.slice(1).toLowerCase()}
  </span>
);

export function Pagination({ data, onPage }) {
  if (!data || data.totalPages <= 1)
    return data ? <p className="mt-3 text-xs text-slate-500">{data.total} total</p> : null;
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm">
      <span className="text-slate-600">
        Page {data.page} of {data.totalPages} · {data.total} total
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={data.page <= 1}
          onClick={() => onPage(data.page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={data.page >= data.totalPages}
          onClick={() => onPage(data.page + 1)}
        >
          Next
        </button>
      </span>
    </nav>
  );
}

// loading / error (with retry) / empty / data, in one place so every list behaves the same.
export function QueryState({ query, emptyText, children }) {
  if (query.isLoading)
    return (
      <p role="status" className="py-8 text-center text-slate-500">
        Loading…
      </p>
    );
  if (query.isError) {
    return (
      <Alert type="error">
        {query.error.message}{' '}
        <button type="button" className="underline" onClick={() => query.refetch()}>
          Retry
        </button>
      </Alert>
    );
  }
  if (query.data.items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 py-10 text-center text-slate-500">
        {emptyText}
      </p>
    );
  }
  return children(query.data);
}

export const TableWrap = ({ children, label }) => (
  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
    <table className="w-full text-left text-sm" aria-label={label}>
      {children}
    </table>
  </div>
);
export const Th = ({ children }) => (
  <th scope="col" className="whitespace-nowrap bg-slate-50 px-4 py-2 font-medium text-slate-600">
    {children}
  </th>
);
export const Td = ({ children, className = '' }) => (
  <td className={`px-4 py-3 align-top ${className}`}>{children}</td>
);

export const PageHeader = ({ title, children, subtitle }) => (
  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
    </div>
    <div className="flex gap-2">{children}</div>
  </div>
);

export const FilterBar = ({ children }) => (
  <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>
);
export function FilterField({ label, children }) {
  return (
    <label className="text-xs font-medium text-slate-600">
      {label}
      <div className="mt-1 font-normal">{children}</div>
    </label>
  );
}
