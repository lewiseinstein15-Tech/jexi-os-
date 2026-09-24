/** Empty canvas per route. Real surfaces land in Scopes B/C/D. */
export default function Placeholder({ route }) {
  return (
    <div className="jx-placeholder">
      <div className="jx-ph-frame" aria-hidden="true"></div>
      <div className="jx-ph-name">{route.title}</div>
      <div className="jx-ph-note">
        {route.id === 'chat' && 'chat runtime mounts here in Scope B'}
        {route.id === 'settings' && 'settings surface lands in Scope C'}
        {route.id === 'graph' && 'work graph lands in Scope D'}
      </div>
    </div>
  );
}
