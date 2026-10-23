const STYLES = {
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
};

export default function Alert({ type = 'info', children }) {
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-3 py-2 text-sm ${STYLES[type]}`}
    >
      {children}
    </div>
  );
}
