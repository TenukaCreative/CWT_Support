import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import { fmtDateTime } from '../../lib/tickets.js';
import { StarPicker, Stars } from '../../components/Stars.jsx';

// Shown to the customer who raised a resolved/closed ticket. The email link (?rate=1) lands here
// focused on the first star.
export default function FeedbackPanel({ ticket }) {
  const [params] = useSearchParams();
  const fb = ticket.feedback;
  const [rating, setRating] = useState(fb?.rating ?? 0);
  const [comment, setComment] = useState(fb?.comment ?? '');
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const firstStar = useRef(null);

  useEffect(() => {
    if (params.get('rate') && ticket.canRate && ref.current) {
      ref.current.scrollIntoView?.({ block: 'center' });
      firstStar.current?.focus();
    }
  }, [params, ticket.canRate]);

  const save = useAdminMutation(
    (body) => api(`/tickets/${ticket.id}/feedback`, { method: 'POST', body }),
    {
      invalidate: ['ticket'],
      success: fb ? 'Rating updated' : 'Thanks for your feedback!',
    },
  );
  const submit = (e) => {
    e.preventDefault();
    setError(null);
    if (!rating) return setError('Choose a rating from 1 to 5 stars.');
    save.mutate({ rating, ...(comment.trim() ? { comment: comment.trim() } : {}) });
  };

  if (!ticket.canRate && !fb) return null;

  if (!ticket.canRate) {
    return (
      <section aria-label="Your feedback" className="card space-y-1">
        <h2 className="font-medium">Your feedback</h2>
        <Stars value={fb.rating} />
        {fb.comment && <p className="whitespace-pre-wrap text-sm text-slate-700">{fb.comment}</p>}
        <p className="text-xs text-slate-500">Ratings can no longer be changed.</p>
      </section>
    );
  }

  return (
    <form
      ref={ref}
      onSubmit={submit}
      className="card space-y-3"
      aria-label="Rate the support you received"
    >
      <h2 className="font-medium">{fb ? 'Your feedback' : 'How did we do?'}</h2>
      <StarPicker value={rating} onChange={setRating} inputRef={firstStar} />
      <div>
        <label htmlFor="fb-comment" className="mb-1 block text-sm font-medium text-slate-700">
          Comment <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <textarea
          id="fb-comment"
          rows={3}
          maxLength={2000}
          className="input"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {fb ? 'Update rating' : 'Submit rating'}
        </button>
        {fb && (
          <span className="text-xs text-slate-500">
            You can change this until {fmtDateTime(fb.editableUntil)}.
          </span>
        )}
      </div>
    </form>
  );
}
