// Phase 24 shell — three routes. Hash-based navigation, no router dependency.
export const ROUTES = [
  { id: 'chat', label: 'Chat', hash: '#/chat', title: 'Chat' },
  { id: 'settings', label: 'Settings', hash: '#/settings', title: 'Settings' },
  { id: 'graph', label: 'Work Graph', hash: '#/graph', title: 'Work Graph' },
];

export const DEFAULT_ROUTE = ROUTES[0];

/** Dev-only token inspector route (not a sidebar item). */
export const TOKENS_HASH = '#/tokens';

export function routeFromHash(hash) {
  const found = ROUTES.find((r) => r.hash === hash);
  return found || DEFAULT_ROUTE;
}
