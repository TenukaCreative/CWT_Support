export const STATUS_LABELS = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CUSTOMER: 'Waiting on customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
};
export const PRIORITY_LABELS = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };
export const ACTIVE_STATUSES = 'OPEN,IN_PROGRESS,WAITING_ON_CUSTOMER,REOPENED';

export const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export const fmtBytes = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

// Client-side mirror of the server's upload rules, so people get instant feedback.
// The server re-checks everything (extension, MIME, size, file signature).
export const ALLOWED_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  'txt',
  'docx',
  'xlsx',
  'zip',
];
export const MAX_FILE_MB = 10;
export const MAX_FILES = 5;

export function validateFiles(files) {
  if (files.length > MAX_FILES) return `You can attach up to ${MAX_FILES} files.`;
  for (const f of files) {
    const ext = f.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext))
      return `"${f.name}" is not an allowed type (images, PDF, txt, docx, xlsx, zip).`;
    if (f.size > MAX_FILE_MB * 1024 * 1024) return `"${f.name}" is larger than ${MAX_FILE_MB} MB.`;
  }
  return null;
}

export function describeEvent(e) {
  switch (e.type) {
    case 'CREATED':
      return 'Ticket created';
    case 'STATUS_CHANGED':
      return `Status: ${STATUS_LABELS[e.fromValue] ?? e.fromValue} → ${STATUS_LABELS[e.toValue] ?? e.toValue}`;
    case 'REOPENED':
      return 'Ticket reopened';
    case 'ASSIGNED':
      return e.toValue
        ? `Assigned to ${e.toValue}${e.fromValue ? ` (was ${e.fromValue})` : ''}`
        : `Unassigned (was ${e.fromValue})`;
    case 'PRIORITY_CHANGED':
      return `Priority: ${PRIORITY_LABELS[e.fromValue] ?? e.fromValue} → ${PRIORITY_LABELS[e.toValue] ?? e.toValue}`;
    case 'CATEGORY_CHANGED':
      return `Category: ${e.fromValue ?? 'none'} → ${e.toValue ?? 'none'}`;
    case 'MERGED':
      return e.toValue
        ? `Merged into ${e.toValue}`
        : `Ticket ${e.fromValue} was merged into this ticket`;
    default:
      return e.type;
  }
}
