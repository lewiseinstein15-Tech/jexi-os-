/**
 * JEXI OS — Phase 23 Scope B — forgejo-mcp administration tools (12).
 *
 * Data-only module; see repo-tools.js for the entry shape. Tool surface
 * follows the Forgejo/Gitea admin API: user lifecycle, org creation on
 * behalf of users, scheduled maintenance (cron), queues, version.
 *
 * NOTE ON CREDENTIALS: no tool in this taxonomy accepts an inline secret.
 * create-user deliberately offers randomPassword / mustChangePassword
 * instead of a password parameter — a credential that never enters the
 * tool call surface can never leak through it. Connection tokens ride
 * via env or keyRef on the transport config (see transport.js).
 */

export const ADMIN_TOOLS = [
  { short: 'list-users', description: 'List all user accounts on the instance (admin only).', params: [['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'create-user', description: 'Create a user account (admin only). Password is generated server-side, never passed inline.', params: [['username', true, 'string', 'Username for the new account'], ['email', true, 'string', 'Email for the new account'], ['mustChangePassword', false, 'boolean', 'Force a password change at first login'], ['randomPassword', false, 'boolean', 'Let the forge generate the initial password and email it']] },
  { short: 'edit-user', description: 'Edit a user account: flags, visibility, admin status (admin only).', params: [['username', true, 'string', 'User to edit'], ['admin', false, 'boolean', 'Grant or revoke instance admin'], ['active', false, 'boolean', 'Activate or deactivate the account'], ['banned', false, 'boolean', 'Ban or unban the account']] },
  { short: 'delete-user', description: 'Delete a user account (admin only).', params: [['username', true, 'string', 'User to delete'], ['purge', false, 'boolean', 'Also delete the user repositories, organizations and comments']] },
  { short: 'rename-user', description: 'Rename a user account (admin only). References follow the rename.', params: [['username', true, 'string', 'Current username'], ['newUsername', true, 'string', 'New username']] },
  { short: 'list-emails', description: 'List all registered email addresses (admin only).', params: [['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'create-org', description: 'Create an organization on behalf of a user (admin only).', params: [['username', true, 'string', 'User who will own the organization'], ['name', true, 'string', 'Organization name'], ['fullName', false, 'string', 'Full display name']] },
  { short: 'list-orgs', description: 'List all organizations on the instance (admin only).', params: [['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'cron-list', description: 'List scheduled maintenance tasks and their last run (admin only).', params: [] },
  { short: 'cron-run', description: 'Run a scheduled maintenance task once, now (admin only).', params: [['name', true, 'string', 'Cron task name as reported by admin.cron-list']] },
  { short: 'get-version', description: 'Get the forge version (server diagnostics).', params: [] },
  { short: 'list-queues', description: 'List background queues and their health (admin only).', params: [] },
];
