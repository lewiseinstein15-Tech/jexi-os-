/** General prefs: theme (light/dark), persisted. */
export default function GeneralSection({ theme, onTheme }) {
  return (
    <section className="p24-section">
      <h2 className="p24-section-title">General</h2>
      <div className="p24-srow">
        <div className="p24-srow-label">
          <div className="p24-srow-name">Theme</div>
          <div className="p24-srow-sub">persisted locally; light reuses approved hexes inverted</div>
        </div>
        <div className="p24-btn-group" role="radiogroup" aria-label="Theme">
          <button className={'p24-mode-btn' + (theme === 'dark' ? ' is-active' : '')} onClick={() => onTheme('dark')}>dark</button>
          <button className={'p24-mode-btn' + (theme === 'light' ? ' is-active' : '')} onClick={() => onTheme('light')}>light</button>
        </div>
      </div>
    </section>
  );
}
