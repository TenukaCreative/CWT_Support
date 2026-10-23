import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../context/ToastContext.jsx';

// Mutation + success toast + cache invalidation + error toast, so pages stay declarative.
export function useAdminMutation(fn, { success, invalidate = [], onSuccess } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data, vars) => {
      await Promise.all(invalidate.map((key) => qc.invalidateQueries({ queryKey: [key] })));
      if (success) toast.success(typeof success === 'function' ? success(data, vars) : success);
      onSuccess?.(data, vars);
    },
    onError: (err) =>
      toast.error(
        err.details?.[0]?.message ? `${err.message}: ${err.details[0].message}` : err.message,
      ),
  });
}
