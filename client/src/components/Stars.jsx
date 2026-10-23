import { useState } from 'react';

// Filled and empty stars differ by SHAPE as well as colour, and both clear 3:1 on white
// (amber-600 3.2:1, slate-500 4.8:1), so the rating never depends on colour alone.
export function Stars({ value, label }) {
  return (
    <span
      role="img"
      aria-label={label ?? `${value} out of 5 stars`}
      className="text-lg tracking-tight"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          aria-hidden="true"
          className={n <= value ? 'text-amber-600' : 'text-slate-500'}
        >
          {n <= value ? '★' : '☆'}
        </span>
      ))}
    </span>
  );
}

// Accessible star picker: a real radio group (arrow keys work), stars are decoration.
export function StarPicker({ value, onChange, name = 'rating', inputRef }) {
  const [hover, setHover] = useState(0);
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-slate-700">Your rating</legend>
      <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className="cursor-pointer rounded text-3xl leading-none has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600"
            onMouseEnter={() => setHover(n)}
          >
            <input
              ref={n === 1 ? inputRef : undefined}
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={n <= (hover || value) ? 'text-amber-600' : 'text-slate-500'}
            >
              {n <= (hover || value) ? '★' : '☆'}
            </span>
            <span className="sr-only">
              {n} star{n > 1 ? 's' : ''}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
