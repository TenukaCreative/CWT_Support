import { Children, cloneElement, useId } from 'react';

// Label + control + error, wired for screen readers (for/id, aria-invalid, aria-describedby).
export default function Field({ label, error, hint, children }) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const child = Children.only(children);
  const describedBy = [error && errId, hint && hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {cloneElement(child, {
        id,
        'aria-invalid': error ? 'true' : undefined,
        'aria-describedby': describedBy,
      })}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
