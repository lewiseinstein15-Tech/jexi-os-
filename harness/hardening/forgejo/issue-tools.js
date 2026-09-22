/**
 * JEXI OS — Phase 23 Scope B — forgejo-mcp issue tools (22).
 *
 * Data-only module; see repo-tools.js for the entry shape. Tool surface
 * follows the Forgejo/Gitea issue API: issues, comments, labels,
 * milestones, assignees. In Forgejo a pull request IS an issue, so the
 * pr.* tools reuse the comment endpoints over the PR index.
 */

export const ISSUE_TOOLS = [
  { short: 'list', description: 'List issues of a repository, filterable by state.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['state', false, 'string', 'open, closed or all; defaults to open'], ['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'search', description: 'Search issues across repositories the token can see.', params: [['q', true, 'string', 'Search keyword'], ['state', false, 'string', 'open, closed or all'], ['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'get', description: 'Get an issue by index, including labels and assignees.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['index', true, 'number', 'Issue index']] },
  { short: 'create', description: 'Create an issue.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['title', true, 'string', 'Issue title'], ['body', false, 'string', 'Issue body (markdown)'], ['labels', false, 'array', 'Label names to apply'], ['assignees', false, 'array', 'Usernames to assign']] },
  { short: 'edit', description: "Edit an issue's title or body.", params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['index', true, 'number', 'Issue index'], ['title', false, 'string', 'New title'], ['body', false, 'string', 'New body']] },
  { short: 'close', description: 'Close an issue.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['index', true, 'number', 'Issue index']] },
  { short: 'reopen', description: 'Reopen a closed issue.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['index', true, 'number', 'Issue index']] },
  { short: 'assign', description: 'Replace the assignees of an issue.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['index', true, 'number', 'Issue index'], ['assignees', true, 'array', 'Full new set of assignee usernames']] },
  { short: 'list-comments', description: 'List comments on an issue, oldest first.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['index', true, 'number', 'Issue index'], ['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'add-comment', description: 'Comment on an issue.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['index', true, 'number', 'Issue index'], ['body', true, 'string', 'Comment body (markdown)']] },
  { short: 'edit-comment', description: 'Edit an issue comment.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['id', true, 'number', 'Comment id'], ['body', true, 'string', 'New comment body']] },
  { short: 'delete-comment', description: 'Delete an issue comment.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['id', true, 'number', 'Comment id']] },
  { short: 'list-labels', description: "List the repository's label set.", params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'create-label', description: 'Create a repository label.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['name', true, 'string', 'Label name'], ['color', true, 'string', 'Hex color without the # prefix']] },
  { short: 'delete-label', description: 'Delete a repository label. Issues lose it immediately.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['id', true, 'number', 'Label id']] },
  { short: 'add-labels', description: 'Add labels to an issue without touching existing ones.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['index', true, 'number', 'Issue index'], ['labels', true, 'array', 'Label ids to add']] },
  { short: 'replace-labels', description: 'Replace the full label set of an issue.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['index', true, 'number', 'Issue index'], ['labels', true, 'array', 'Full new set of label ids']] },
  { short: 'remove-label', description: 'Remove one label from an issue.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['index', true, 'number', 'Issue index'], ['id', true, 'number', 'Label id to remove']] },
  { short: 'list-milestones', description: 'List milestones of a repository.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['state', false, 'string', 'open, closed or all'], ['page', false, 'number', '1-based page number'], ['limit', false, 'number', 'Page size']] },
  { short: 'create-milestone', description: 'Create a milestone.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['title', true, 'string', 'Milestone title'], ['dueOn', false, 'string', 'ISO 8601 due date']] },
  { short: 'edit-milestone', description: 'Edit a milestone.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['id', true, 'number', 'Milestone id'], ['title', false, 'string', 'New title'], ['dueOn', false, 'string', 'New ISO 8601 due date']] },
  { short: 'delete-milestone', description: 'Delete a milestone. Issues keep their state but lose the milestone.', params: [['owner', true, 'string', 'Repository owner'], ['repo', true, 'string', 'Repository name'], ['id', true, 'number', 'Milestone id']] },
];
