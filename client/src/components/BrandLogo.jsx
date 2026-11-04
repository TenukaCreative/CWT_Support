import { Link } from 'react-router-dom';

// One place for the brand mark so the app and public layouts stay identical. When the real logo
// arrives, put it in client/public/brand/logo.svg and swap the span for
// <img src="/brand/logo.svg" alt="" className="h-8" />.
export default function BrandLogo({ to }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 text-lg font-semibold text-white focus-visible:outline-white"
    >
      <span
        aria-hidden="true"
        className="grid h-8 w-8 place-items-center rounded-md bg-brand-600 text-xs font-bold"
      >
        CWT
      </span>
      SupportDesk
    </Link>
  );
}
