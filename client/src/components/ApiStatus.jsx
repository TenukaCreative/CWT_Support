import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

// Proves the full chain works: React -> Vite proxy -> Express -> Prisma -> Postgres.
export default function ApiStatus() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: () => api('/health/ready'),
    retry: false,
  });

  if (isLoading) return <p role="status">Checking API…</p>;
  if (isError)
    return (
      <p role="alert" className="text-red-700">
        API unreachable: {error.message}
      </p>
    );
  return (
    <p role="status" className="text-emerald-700">
      API {data.status} · database {data.database}
    </p>
  );
}
