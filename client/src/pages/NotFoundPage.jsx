import { Link } from 'react-router-dom';

export default function NotFoundPage({ inApp = false }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-slate-600">
        The page you are looking for does not exist or has moved.
      </p>
      <Link to={inApp ? '/app' : '/'} className="mt-4 inline-block text-brand-700 underline">
        {inApp ? 'Back to your dashboard' : 'Back home'}
      </Link>
    </div>
  );
}
