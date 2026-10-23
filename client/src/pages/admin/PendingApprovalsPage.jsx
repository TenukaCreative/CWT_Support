import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import { fmtDate, useList } from '../../lib/query.js';
import ProjectCheckboxes from '../../components/ProjectCheckboxes.jsx';
import {
  Badge,
  Modal,
  PageHeader,
  Pagination,
  QueryState,
  TableWrap,
  Td,
  Th,
} from '../../components/ui.jsx';

export default function PendingApprovalsPage() {
  const [page, setPage] = useState(1);
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const list = useList('users', '/admin/users', {
    status: 'PENDING',
    role: 'CUSTOMER',
    page,
    limit: 15,
    sort: 'createdAt',
    dir: 'asc',
  });

  return (
    <div>
      <PageHeader
        title="Pending registrations"
        subtitle="Customers who registered and are waiting for access. Oldest first."
      />
      <QueryState query={list} emptyText="Nothing waiting for approval.">
        {(data) => (
          <>
            <TableWrap label="Pending registrations">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Organization</Th>
                  <Th>Registered</Th>
                  <Th>Email</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <Td className="font-medium">{u.name}</Td>
                    <Td>{u.email}</Td>
                    <Td>{u.organization?.name ?? '—'}</Td>
                    <Td>{fmtDate(u.createdAt)}</Td>
                    <Td>
                      {u.emailVerifiedAt ? (
                        <Badge value="ACTIVE" label="Verified" />
                      ) : (
                        <Badge value="PENDING" label="Unverified" />
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <button
                        type="button"
                        className="btn-primary mr-2"
                        disabled={!u.emailVerifiedAt}
                        title={
                          u.emailVerifiedAt ? undefined : 'The user must verify their email first'
                        }
                        aria-label={`Approve ${u.name}`}
                        onClick={() => setApproving(u)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        aria-label={`Reject ${u.name}`}
                        onClick={() => setRejecting(u)}
                      >
                        Reject
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination data={data} onPage={setPage} />
          </>
        )}
      </QueryState>
      {approving && <ApproveModal user={approving} onClose={() => setApproving(null)} />}
      {rejecting && <RejectModal user={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  );
}

function ApproveModal({ user, onClose }) {
  const [projectIds, setProjectIds] = useState([]);
  const approve = useAdminMutation(
    (ids) => api(`/admin/users/${user.id}/approve`, { method: 'POST', body: { projectIds: ids } }),
    {
      invalidate: ['users', 'projects'],
      success: `${user.name} approved`,
      onSuccess: onClose,
    },
  );
  return (
    <Modal title={`Approve ${user.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        {user.email} · {user.organization?.name}. Choose the projects they can access.
      </p>
      <ProjectCheckboxes
        organizationId={user.organization?.id}
        value={projectIds}
        onChange={setProjectIds}
      />
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={approve.isPending}
          onClick={() => approve.mutate(projectIds)}
        >
          Approve
        </button>
      </div>
    </Modal>
  );
}

function RejectModal({ user, onClose }) {
  const [reason, setReason] = useState('');
  const reject = useAdminMutation(
    (r) => api(`/admin/users/${user.id}/reject`, { method: 'POST', body: r ? { reason: r } : {} }),
    {
      invalidate: ['users'],
      success: `${user.name} rejected`,
      onSuccess: onClose,
    },
  );
  return (
    <Modal title={`Reject ${user.name}?`} onClose={onClose}>
      <p className="text-sm text-slate-600">
        They will be emailed and cannot log in. The record is kept.
      </p>
      <label className="mt-3 block text-sm font-medium text-slate-700">
        Reason (optional, included in the email)
        <textarea
          rows={3}
          maxLength={500}
          className="input mt-1"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
          disabled={reject.isPending}
          onClick={() => reject.mutate(reason.trim())}
        >
          Reject
        </button>
      </div>
    </Modal>
  );
}
