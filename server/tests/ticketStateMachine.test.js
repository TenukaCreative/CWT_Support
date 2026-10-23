import {
  STATUSES,
  allowedTransitions,
  assertTransition,
  canTransition,
} from '../src/lib/ticketStateMachine.js';

// The complete truth table, written out so a change to the rules has to change a test.
const EXPECTED = {
  STAFF: {
    OPEN: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'],
    IN_PROGRESS: ['WAITING_ON_CUSTOMER', 'RESOLVED'],
    WAITING_ON_CUSTOMER: ['IN_PROGRESS', 'RESOLVED'],
    REOPENED: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'],
    RESOLVED: ['REOPENED', 'CLOSED'],
    CLOSED: [],
  },
  CUSTOMER: {
    OPEN: ['CLOSED'],
    IN_PROGRESS: ['CLOSED'],
    WAITING_ON_CUSTOMER: ['CLOSED'],
    REOPENED: ['CLOSED'],
    RESOLVED: ['REOPENED', 'CLOSED'],
    CLOSED: [],
  },
  SYSTEM: {
    OPEN: ['IN_PROGRESS', 'CLOSED'],
    IN_PROGRESS: ['CLOSED'],
    WAITING_ON_CUSTOMER: ['IN_PROGRESS', 'CLOSED'],
    REOPENED: ['IN_PROGRESS', 'CLOSED'],
    RESOLVED: ['CLOSED'],
    CLOSED: [],
  },
};
const ROLE_FOR = { STAFF: 'SUPPORT', CUSTOMER: 'CUSTOMER', SYSTEM: 'SYSTEM' };

describe('ticket state machine', () => {
  for (const [actor, table] of Object.entries(EXPECTED)) {
    describe(actor, () => {
      for (const from of STATUSES) {
        it(`${from} -> ${table[from].join(', ') || '(nothing)'}`, () => {
          const role = ROLE_FOR[actor];
          expect([...allowedTransitions(from, role)].sort()).toEqual([...table[from]].sort());
          for (const to of STATUSES) {
            expect(canTransition(from, to, role)).toBe(table[from].includes(to));
          }
        });
      }
    });
  }

  it('admins follow the staff rules', () => {
    expect(allowedTransitions('OPEN', 'ADMIN')).toEqual(allowedTransitions('OPEN', 'SUPPORT'));
  });

  it('CLOSED is terminal for everyone', () => {
    for (const role of ['SUPPORT', 'ADMIN', 'CUSTOMER', 'SYSTEM'])
      expect(allowedTransitions('CLOSED', role)).toEqual([]);
  });

  it('nobody can move a ticket back to OPEN or to its own status', () => {
    for (const role of ['SUPPORT', 'CUSTOMER', 'SYSTEM']) {
      for (const from of STATUSES) {
        expect(canTransition(from, 'OPEN', role)).toBe(false);
        expect(canTransition(from, from, role)).toBe(false);
      }
    }
  });

  it('only staff can set WAITING_ON_CUSTOMER / RESOLVED / IN_PROGRESS directly', () => {
    for (const to of ['WAITING_ON_CUSTOMER', 'RESOLVED', 'IN_PROGRESS']) {
      for (const from of STATUSES) expect(canTransition(from, to, 'CUSTOMER')).toBe(false);
    }
  });

  it('assertTransition throws a 409 INVALID_TRANSITION with details', () => {
    expect(() => assertTransition('OPEN', 'CLOSED', 'SUPPORT')).toThrow(
      expect.objectContaining({
        status: 409,
        code: 'INVALID_TRANSITION',
        details: { from: 'OPEN', to: 'CLOSED' },
      }),
    );
    expect(() => assertTransition('OPEN', 'RESOLVED', 'SUPPORT')).not.toThrow();
  });
});
