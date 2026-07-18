import { describe, expect, it } from 'vitest';

import { createRolePolicy } from './role-policy.js';

type Role = 'owner' | 'admin' | 'member' | 'read';
type Permission = 'organization.manage' | 'resource.write' | 'resource.read';

const policy = createRolePolicy<Role, Permission>({
  permissions: {
    owner: ['organization.manage', 'resource.write', 'resource.read'],
    admin: ['resource.write', 'resource.read'],
    member: ['resource.write', 'resource.read'],
    read: ['resource.read'],
  },
  assignableRoles: {
    owner: ['admin', 'member', 'read'],
    admin: ['member', 'read'],
    member: [],
    read: [],
  },
  manageableRoles: {
    owner: ['admin', 'member', 'read'],
    admin: ['member', 'read'],
    member: [],
    read: [],
  },
});

describe('createRolePolicy', () => {
  it('checks permissions without knowing where roles are stored', () => {
    expect(policy.hasPermission('member', 'resource.write')).toBe(true);
    expect(policy.hasPermission('read', 'resource.write')).toBe(false);
  });

  it('keeps owner and admin assignment boundaries explicit', () => {
    expect(policy.canAssignRole('owner', 'admin')).toBe(true);
    expect(policy.canAssignRole('admin', 'admin')).toBe(false);
    expect(policy.canAssignRole('admin', 'read')).toBe(true);
  });

  it('requires both current-role management and next-role assignment', () => {
    expect(policy.canChangeRole('admin', 'member', 'read')).toBe(true);
    expect(policy.canChangeRole('admin', 'admin', 'read')).toBe(false);
    expect(policy.canChangeRole('admin', 'read', 'admin')).toBe(false);
  });

  it.each(['corrupt-role', 'constructor', 'toString', '__proto__'])(
    'denies unknown runtime role %s instead of throwing',
    (value) => {
      const unknownRole = value as Role;
      expect(policy.hasPermission(unknownRole, 'resource.read')).toBe(false);
      expect(policy.canAssignRole(unknownRole, 'read')).toBe(false);
      expect(policy.canManageRole(unknownRole, 'read')).toBe(false);
      expect(policy.canChangeRole(unknownRole, 'member', 'read')).toBe(false);
    },
  );

  it('denies prototype-named target roles instead of throwing', () => {
    const unknownRole = 'constructor' as Role;
    expect(policy.hasPermission(unknownRole, 'resource.read')).toBe(false);
    expect(policy.canAssignRole('owner', unknownRole)).toBe(false);
    expect(policy.canManageRole('owner', unknownRole)).toBe(false);
    expect(policy.canChangeRole('owner', unknownRole, 'read')).toBe(false);
    expect(policy.canChangeRole('owner', 'member', unknownRole)).toBe(false);
  });
});
