import { Link } from 'react-router-dom';
import { LifeBuoy, Ticket, Star } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { homeFor } from '../lib/navigation.js';

const FEATURES = [
  {
    icon: LifeBuoy,
    title: 'Find answers fast',
    text: 'Search our help center before you raise a ticket.',
  },
  {
    icon: Ticket,
    title: 'Raise and track tickets',
    text: 'Tell us what you need and follow it until it is resolved.',
  },
  {
    icon: Star,
    title: 'Rate our support',
    text: 'Once a ticket is resolved, tell us how we did.',
  },
];

export default function HomePage() {
  const { status, user } = useAuth();
  const signedIn = status === 'authenticated';
  return (
    <div className="space-y-12 py-6">
      <section className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          CWT client support
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-900">
          Welcome to SupportDesk
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Get help with your projects: search answers, raise tickets and track them to resolution.
        </p>
        <Link to={signedIn ? homeFor(user.role) : '/login'} className="btn-primary mt-6">
          {signedIn ? 'Open the app' : 'Log in to your account'}
        </Link>
      </section>

      <section aria-label="What you can do" className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card">
            <Icon aria-hidden="true" className="h-6 w-6 text-brand-600" />
            <h2 className="mt-3 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
