import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { qs } from '../../lib/query.js';
import { validateFiles } from '../../lib/tickets.js';
import Field from '../../components/Field.jsx';
import Alert from '../../components/Alert.jsx';
import FileInput from '../../components/FileInput.jsx';
import FaqSuggestions from '../../components/FaqSuggestions.jsx';

export default function NewTicketPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [serverError, setServerError] = useState(null);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const [hasSuggestions, setHasSuggestions] = useState(false);
  const [proceed, setProceed] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      subject: params.get('subject') ?? '',
      description: '',
      priority: 'MEDIUM',
      categoryId: '',
    },
  });
  const subject = watch('subject');
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });

  // Self-service first: if the live search found articles, ask whether they were enough before
  // showing the rest of the form.
  const suggesting = hasSuggestions && subject.trim().length >= 3;
  const showRest = !suggesting || proceed;

  // Record the search (including zero-result ones) once, deliberately: not on every keystroke.
  const logSearch = async () => {
    const text = subject.trim();
    if (text.length < 3) return null;
    try {
      return (await api(`/faq/suggest${qs({ q: text, log: 'true' })}`)).searchLogId;
    } catch {
      return null;
    }
  };

  const answered = async () => {
    await logSearch();
    toast.success('Glad we could help!');
    navigate('/app');
  };

  const onSubmit = async (values) => {
    setServerError(null);
    const problem = validateFiles(files);
    if (problem) return setFileError(problem);

    const form = new FormData();
    form.set('subject', values.subject);
    form.set('description', values.description);
    form.set('priority', values.priority);
    if (values.categoryId) form.set('categoryId', values.categoryId);
    const searchLogId = await logSearch();
    if (searchLogId) form.set('searchLogId', searchLogId);
    files.forEach((f) => form.append('files', f));

    try {
      const res = await api('/tickets', { method: 'POST', body: form });
      toast.success(`Ticket ${res.ticket.number} created`);
      navigate(`/app/tickets/${res.ticket.id}`);
    } catch (err) {
      setServerError(err.details?.[0]?.message ?? err.message);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">New ticket</h1>
      <p className="mt-1 text-sm text-slate-600">
        Tell us what is wrong. We may already have an answer.
      </p>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="card mt-4 space-y-4">
        {serverError && <Alert type="error">{serverError}</Alert>}
        <Field label="Subject" error={errors.subject?.message}>
          <input
            className="input"
            {...register('subject', {
              required: 'Subject is required',
              minLength: { value: 5, message: 'At least 5 characters' },
              maxLength: { value: 200, message: 'At most 200 characters' },
            })}
          />
        </Field>

        <FaqSuggestions query={subject} onResults={(r) => setHasSuggestions(r.items.length > 0)} />
        {suggesting && !proceed && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Did this help?">
            <button type="button" className="btn-primary" onClick={answered}>
              This answered my question
            </button>
            <button type="button" className="btn-secondary" onClick={() => setProceed(true)}>
              Still need help, create a ticket
            </button>
          </div>
        )}

        {showRest && (
          <>
            <Field
              label="Description"
              error={errors.description?.message}
              hint="What happened, what you expected, and any steps to reproduce."
            >
              <textarea
                rows={7}
                className="input"
                {...register('description', {
                  required: 'Please describe the problem',
                  minLength: { value: 10, message: 'At least 10 characters' },
                  maxLength: { value: 10000, message: 'At most 10,000 characters' },
                })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category">
                <select className="input" {...register('categoryId')}>
                  <option value="">Not sure</option>
                  {cats.data?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority" hint="How much is this blocking you?">
                <select className="input" {...register('priority')}>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
              </Field>
            </div>
            <FileInput files={files} onChange={setFiles} error={fileError} onError={setFileError} />
            <button type="submit" disabled={isSubmitting} className="btn-primary">
              {isSubmitting ? 'Creating…' : 'Create ticket'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
