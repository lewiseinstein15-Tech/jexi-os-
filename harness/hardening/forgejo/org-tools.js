/**
 * JEXI OS — Phase 23 Scope B — forgejo-mcp organization tools (16).
 *
 * Data-only module; see repo-tools.js for the entry shape. Tool surface
 * follows the Forgejo/Gitea organization API: org lifecycle, membership,
 * teams and team membership/repos. Org-scoped webhooks live under
 * admin/list scope here; repo webhooks are under repo.*.
 */

export const ORG_TOOLS = [
  { short: 'list', description: 'List organizations the authenticated account belongs to.', params: [['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'get', description: 'Get an organization by name.', params: [['org', true, 'string', 'Organization name']] },
  { short: 'create', description: 'Create an organization owned by the authenticated user.', params: [['name', true, 'string', 'Organization name'], ['fullName', false, 'string', 'Full display name'], ['description', false, 'string', 'Organization description']] },
  { short: 'edit', description: 'Edit organization properties.', params: [['org', true, 'string', 'Organization name'], ['fullName', false, 'string', 'New full display name'], ['description', false, 'string', 'New description'], ['website', false, 'string', 'New website URL']] },
  { short: 'list-members', description: 'List members of an organization.', params: [['org', true, 'string', 'Organization name'], ['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'get-member', description: 'Check whether a user is a member of an organization.', params: [['org', true, 'string', 'Organization name'], ['username', true, 'string', 'User to check']] },
  { short: 'remove-member', description: 'Remove a user from an organization.', params: [['org', true, 'string', 'Organization name'], ['username', true, 'string', 'User to remove']] },
  { short: 'list-teams', description: 'List teams of an organization.', params: [['org', true, 'string', 'Organization name'], ['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'get-team', description: 'Get a team by id, including its permission level.', params: [['org', true, 'string', 'Organization name'], ['id', true, 'number', 'Team id']] },
  { short: 'create-team', description: 'Create a team in an organization.', params: [['org', true, 'string', 'Organization name'], ['name', true, 'string', 'Team name'], ['permission', false, 'string', 'read, write or admin; defaults to read'], ['units', false, 'array', 'Repo units the team can access (e.g. code, issues)']] },
  { short: 'delete-team', description: 'Delete a team by id. Members keep their org membership.', params: [['org', true, 'string', 'Organization name'], ['id', true, 'number', 'Team id']] },
  { short: 'list-team-members', description: 'List members of a team.', params: [['org', true, 'string', 'Organization name'], ['id', true, 'number', 'Team id'], ['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'add-team-member', description: 'Add a user to a team.', params: [['org', true, 'string', 'Organization name'], ['id', true, 'number', 'Team id'], ['username', true, 'string', 'User to add']] },
  { short: 'remove-team-member', description: 'Remove a user from a team.', params: [['org', true, 'string', 'Organization name'], ['id', true, 'number', 'Team id'], ['username', true, 'string', 'User to remove']] },
  { short: 'list-team-repos', description: 'List repositories a team can access.', params: [['org', true, 'string', 'Organization name'], ['id', true, 'number', 'Team id'], ['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'list-repos', description: "List an organization's repositories.", params: [['org', true, 'string', 'Organization name'], ['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
];
