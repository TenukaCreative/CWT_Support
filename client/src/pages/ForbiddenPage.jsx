import { Link } from 'react-router-dom';

export default function ForbiddenPage() {
  return (
    <div className="py-12 text-center">
      <h1 className="text-2xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-slate-600">Your role does not include this area.</p>
      <Link to="/app" className="mt-4 inline-block text-brand-700 underline">
        Back to your dashboard
      </Link>
    </div>
  );
}
