import { Link } from 'react-router-dom';
import { fmtDateTime } from '../../lib/tickets.js';
import { PriorityBadge, StatusBadge } from '../../components/TicketBadges.jsx';
import SlaBadge from '../../components/SlaBadge.jsx';
import { TableWrap, Td, Th } from '../../components/ui.jsx';

// Shared ticket table. `staff` adds project/customer/assignee columns; `selectable` adds checkboxes.
export default function TicketTable({
  items,
  staff = false,
  selectable = false,
  selected = [],
  onToggle,
  onToggleAll,
}) {
  const allChecked = items.length > 0 && items.every((t) => selected.includes(t.id));
  return (
    <TableWrap label="Tickets">
      <thead>
        <tr>
          {selectable && (
            <Th>
              <input
                type="checkbox"
                aria-label="Select all tickets on this page"
                checked={allChecked}
                onChange={() => onToggleAll(!allChecked)}
              />
            </Th>
          )}
          <Th>Ticket</Th>
          <Th>Subject</Th>
          <Th>Status</Th>
          <Th>Priority</Th>
          {staff && <Th>SLA</Th>}
          {staff && <Th>Customer</Th>}
          {staff && <Th>Assignee</Th>}
          <Th>Updated</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {items.map((t) => (
          <tr key={t.id}>
            {selectable && (
              <Td>
                <input
                  type="checkbox"
                  aria-label={`Select ${t.number}`}
                  checked={selected.includes(t.id)}
                  onChange={() => onToggle(t.id)}
                />
              </Td>
            )}
            <Td className="whitespace-nowrap font-mono text-xs">
              <Link to={`/app/tickets/${t.id}`} className="text-brand-700 underline">
                {t.number}
              </Link>
            </Td>
            <Td className="max-w-sm">
              <Link to={`/app/tickets/${t.id}`} className="font-medium hover:underline">
                {t.subject}
              </Link>
              {t.mergedInto && (
                <span className="ml-2 text-xs text-slate-500">
                  merged into {t.mergedInto.number}
                </span>
              )}
            </Td>
            <Td>
              <StatusBadge status={t.status} />
            </Td>
            <Td>
              <PriorityBadge priority={t.priority} />
            </Td>
            {staff && (
              <Td>
                <SlaBadge sla={t.sla} />
              </Td>
            )}
            {staff && <Td>{t.createdBy.name}</Td>}
            {staff && (
              <Td>{t.assignee?.name ?? <span className="text-slate-500">Unassigned</span>}</Td>
            )}
            <Td className="whitespace-nowrap">{fmtDateTime(t.updatedAt)}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
