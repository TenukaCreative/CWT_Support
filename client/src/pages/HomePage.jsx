import { Link } from 'react-router-dom';
import ApiStatus from '../components/ApiStatus.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { homeFor } from '../lib/navigation.js';

export default function HomePage() {
  const { status, user } = useAuth();
  return (
    <div>
      <h1 className="text-3xl font-semibold">Welcome to SupportDesk</h1>
      <p className="mt-2 max-w-prose text-slate-600">
        Get help with your projects: search answers, raise tickets and track them to resolution.
      </p>
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">System status</h2>
        <ApiStatus />
      </div>
      <Link
        to={status === 'authenticated' ? homeFor(user.role) : '/login'}
        className="btn-primary mt-6"
      >
        {status === 'authenticated' ? 'Open the app' : 'Log in'}
      </Link>
    </div>
  );
}
