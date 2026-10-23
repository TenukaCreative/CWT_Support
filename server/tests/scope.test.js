import { buildScope, canAccessProject, projectFilter } from '../src/lib/scope.js';

const base = { userId: 'u1', organizationId: 'o1' };

describe('buildScope', () => {
  it('customer: only the active project, and only if they are a member', () => {
    const member = buildScope({
      ...base,
      role: 'CUSTOMER',
      activeProjectId: 'p1',
      accessibleProjectIds: ['p1', 'p2'],
    });
    expect(member.projectIds).toEqual(['p1']);
    const forged = buildScope({
      ...base,
      role: 'CUSTOMER',
      activeProjectId: 'p9',
      accessibleProjectIds: ['p1', 'p2'],
    });
    expect(forged.projectIds).toEqual([]);
  });

  it('customer: "ALL" and "no project" yield nothing', () => {
    expect(
      buildScope({
        ...base,
        role: 'CUSTOMER',
        activeProjectId: 'ALL',
        accessibleProjectIds: ['p1'],
      }).projectIds,
    ).toEqual([]);
    expect(
      buildScope({ ...base, role: 'CUSTOMER', activeProjectId: null, accessibleProjectIds: ['p1'] })
        .projectIds,
    ).toEqual([]);
  });

  it('support: assigned projects only; ALL means all ASSIGNED', () => {
    const one = buildScope({
      ...base,
      role: 'SUPPORT',
      activeProjectId: 'p1',
      accessibleProjectIds: ['p1', 'p2'],
    });
    expect(one.projectIds).toEqual(['p1']);
    const other = buildScope({
      ...base,
      role: 'SUPPORT',
      activeProjectId: 'p3',
      accessibleProjectIds: ['p1', 'p2'],
    });
    expect(other.projectIds).toEqual([]);
    const all = buildScope({
      ...base,
      role: 'SUPPORT',
      activeProjectId: 'ALL',
      accessibleProjectIds: ['p1', 'p2'],
    });
    expect(all.projectIds).toEqual(['p1', 'p2']);
  });

  it('admin: ALL is unrestricted (null), a specific project narrows, nothing selected yields nothing', () => {
    expect(
      buildScope({ role: 'ADMIN', userId: 'a', activeProjectId: 'ALL' }).projectIds,
    ).toBeNull();
    expect(buildScope({ role: 'ADMIN', userId: 'a', activeProjectId: 'p1' }).projectIds).toEqual([
      'p1',
    ]);
    expect(buildScope({ role: 'ADMIN', userId: 'a' }).projectIds).toEqual([]);
  });

  it('is immutable', () => {
    const s = buildScope({
      ...base,
      role: 'CUSTOMER',
      activeProjectId: 'p1',
      accessibleProjectIds: ['p1'],
    });
    expect(Object.isFrozen(s)).toBe(true);
  });
});

describe('helpers', () => {
  it('canAccessProject / projectFilter', () => {
    const s = buildScope({
      ...base,
      role: 'SUPPORT',
      activeProjectId: 'p1',
      accessibleProjectIds: ['p1'],
    });
    expect(canAccessProject(s, 'p1')).toBe(true);
    expect(canAccessProject(s, 'p2')).toBe(false);
    expect(projectFilter(s)).toEqual({ projectId: { in: ['p1'] } });
    const admin = buildScope({ role: 'ADMIN', userId: 'a', activeProjectId: 'ALL' });
    expect(canAccessProject(admin, 'anything')).toBe(true);
    expect(projectFilter(admin)).toEqual({});
  });
});
