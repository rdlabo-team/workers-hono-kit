/** A role-to-permissions lookup used by {@link createRolePolicy}. */
export type RolePermissionMap<Role extends string, Permission extends string> = Readonly<
  Record<Role, readonly Permission[]>
>;

/** A role-to-roles lookup used for assignment and management boundaries. */
export type RoleRelationMap<Role extends string> = Readonly<Record<Role, readonly Role[]>>;

/** Configuration for a storage-agnostic role policy. */
export interface RolePolicyConfig<Role extends string, Permission extends string> {
  /** Permissions granted to each role. */
  permissions: RolePermissionMap<Role, Permission>;
  /** Roles that each actor role may assign to another subject. */
  assignableRoles: RoleRelationMap<Role>;
  /** Existing subject roles that each actor role may manage. */
  manageableRoles: RoleRelationMap<Role>;
}

/** Pure authorization checks produced from a role policy configuration. */
export interface RolePolicy<Role extends string, Permission extends string> {
  /** Returns whether `role` grants `permission`. */
  hasPermission(role: Role, permission: Permission): boolean;
  /** Returns whether `actorRole` may assign `nextRole`. */
  canAssignRole(actorRole: Role, nextRole: Role): boolean;
  /** Returns whether `actorRole` may manage a subject with `targetRole`. */
  canManageRole(actorRole: Role, targetRole: Role): boolean;
  /** Returns whether an actor may change a subject from one role to another. */
  canChangeRole(actorRole: Role, currentRole: Role, nextRole: Role): boolean;
}

function ownListIncludes<Key extends string, Value extends string>(
  record: Partial<Record<Key, readonly Value[]>>,
  key: Key,
  value: Value,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return false;
  }
  return record[key]?.includes(value) ?? false;
}

/**
 * Creates pure, schema-independent RBAC checks.
 *
 * The caller resolves a role from any persistence model (for example `group_users.role`,
 * `users.role`, a token claim, or an external identity provider) and passes that role into these
 * checks. Keeping lookup and policy separate makes the same policy reusable across applications.
 */
export function createRolePolicy<Role extends string, Permission extends string>(
  config: RolePolicyConfig<Role, Permission>,
): RolePolicy<Role, Permission> {
  // Keep the public config strongly typed while treating runtime values as untrusted input.
  const permissions = config.permissions as Partial<Record<Role, readonly Permission[]>>;
  const assignableRoles = config.assignableRoles as Partial<Record<Role, readonly Role[]>>;
  const manageableRoles = config.manageableRoles as Partial<Record<Role, readonly Role[]>>;

  return {
    hasPermission: (role, permission) => ownListIncludes(permissions, role, permission),
    canAssignRole: (actorRole, nextRole) => ownListIncludes(assignableRoles, actorRole, nextRole),
    canManageRole: (actorRole, targetRole) => ownListIncludes(manageableRoles, actorRole, targetRole),
    canChangeRole: (actorRole, currentRole, nextRole) =>
      ownListIncludes(manageableRoles, actorRole, currentRole) && ownListIncludes(assignableRoles, actorRole, nextRole),
  };
}
