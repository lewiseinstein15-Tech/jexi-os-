import { useState } from 'react';
import { loadAppearance, patchAppearance } from '../shell/Shell.jsx';

/**
 * Appearance section (ui-rebuild-premium, NEW).
 *  - Accent: violet (default) / cyan / emerald / amber — re-points --jx-accent
 *  - Font size: small / medium / large  (--jx-fs-body / --jx-fs-ui)
 *  - Density: compact / comfortable     (--jx-row-pad-y / --jx-control-h)
 * State lives in localStorage 'jx-appearance'; Shell.jsx applies it to
 * .jx-shell data-attributes consumed by tokens-premium.css. This view only
 * reads/writes that store — nothing else to keep in sync.
 */

const ACCENTS = [
  { id: 'violet', hex: '#8B5CF6' },
  { id: 'cyan', hex: '#22D3EE' },
  { id: 'emerald', hex: '#10B981' },
  { id: 'amber', hex: '#F59E0B' },
];
const FONT_SIZES = ['small', 'medium', 'large'];
const DENSITIES = ['compact', 'comfortable'];

export default function AppearanceSection() {
  const [appearance, setAppearance] = useState(loadAppearance);
  const accent = appearance.accent || 'violet';
  const fontsize = appearance.fontsize || 'medium';
  const spacing = appearance.spacing || 'comfortable';

  function patch(p) {
    setAppearance(patchAppearance(p));
  }

  return (
    <section className="jx-section">
      <h2 className="jx-section-title">Appearance</h2>

      <div className="jx-srow">
        <div className="jx-srow-label">
          <div className="jx-srow-name">Accent color</div>
          <div className="jx-srow-sub">the one signature color across the console</div>
        </div>
        <div className="jx-srow-control">
          <div className="jx-swatches" role="radiogroup" aria-label="Accent color">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={'jx-swatch' + (accent === a.id ? ' is-active' : '')}
                style={{ background: a.hex }}
                onClick={() => patch({ accent: a.id })}
                aria-label={'accent ' + a.id}
                aria-pressed={accent === a.id}
                title={a.id}
              ></button>
            ))}
          </div>
        </div>
      </div>

      <div className="jx-srow">
        <div className="jx-srow-label">
          <div className="jx-srow-name">Font size</div>
          <div className="jx-srow-sub">body text across chat and views</div>
        </div>
        <div className="jx-srow-control">
          <div className="jx-seg" role="radiogroup" aria-label="Font size">
            {FONT_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className={'jx-seg-btn' + (fontsize === s ? ' is-active' : '')}
                onClick={() => patch({ fontsize: s })}
                aria-pressed={fontsize === s}
              >{s}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="jx-srow">
        <div className="jx-srow-label">
          <div className="jx-srow-name">Spacing</div>
          <div className="jx-srow-sub">row density in lists and settings</div>
        </div>
        <div className="jx-srow-control">
          <div className="jx-seg" role="radiogroup" aria-label="Spacing">
            {DENSITIES.map((s) => (
              <button
                key={s}
                type="button"
                className={'jx-seg-btn' + (spacing === s ? ' is-active' : '')}
                onClick={() => patch({ spacing: s })}
                aria-pressed={spacing === s}
              >{s}</button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
