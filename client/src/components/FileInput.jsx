import { useId } from 'react';
import {
  ALLOWED_EXTENSIONS,
  MAX_FILES,
  MAX_FILE_MB,
  fmtBytes,
  validateFiles,
} from '../lib/tickets.js';

// Controlled attachment picker: instant client-side checks (the server is the real gatekeeper).
export default function FileInput({ files, onChange, error, onError }) {
  const id = useId();
  const add = (e) => {
    const next = [...files, ...Array.from(e.target.files)];
    e.target.value = ''; // allow picking the same file again after removing it
    const problem = validateFiles(next);
    onError?.(problem);
    if (!problem) onChange(next);
  };
  const remove = (i) => {
    onError?.(null);
    onChange(files.filter((_, idx) => idx !== i));
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        Attachments <span className="font-normal text-slate-500">(optional)</span>
      </label>
      <input
        id={id}
        type="file"
        multiple
        accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')}
        onChange={add}
        aria-describedby={`${id}-hint`}
        className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5"
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
        Up to {MAX_FILES} files, {MAX_FILE_MB} MB each: images, PDF, txt, docx, xlsx, zip.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1 text-sm"
            >
              <span>
                {f.name} <span className="text-xs text-slate-500">({fmtBytes(f.size)})</span>
              </span>
              <button
                type="button"
                className="text-xs text-red-700 underline"
                onClick={() => remove(i)}
                aria-label={`Remove ${f.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
