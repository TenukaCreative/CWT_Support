import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

// Clicking a notification marks it read and opens its ticket. Tickets live inside a project, so
// if it belongs to another project than the active one, switch first (the server re-verifies membership).
export function useOpenNotification(afterOpen) {
  const { activeProjectId, projects, selectProject } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  return async (n) => {
    api(`/notifications/${n.id}/read`, { method: 'POST' })
      .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
      .catch(() => {});
    if (!n.ticket) return afterOpen?.();
    try {
      const needsSwitch = activeProjectId !== 'ALL' && activeProjectId !== n.ticket.projectId;
      if (needsSwitch) {
        if (!projects.some((p) => p.id === n.ticket.projectId))
          throw new Error('You no longer have access to that project.');
        await selectProject(n.ticket.projectId);
        qc.removeQueries({ queryKey: ['ticket'] });
      }
      navigate(`/app/tickets/${n.ticket.id}`);
      afterOpen?.();
    } catch (e) {
      toast.error(e.message);
    }
  };
}
