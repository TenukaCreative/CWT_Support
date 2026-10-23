// "ACME-WEB" for a project id, "Global" for null. Projects come from the auth context.
export const projectLabel = (projects, projectId) =>
  projectId ? (projects.find((p) => p.id === projectId)?.key ?? 'Other') : 'Global';
