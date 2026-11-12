import { h } from '../lib/dom.js';

// The mark is a mirrored "R" — reversed — on an accent gradient tile.
export function logoMark(size = 32) {
  const wrap = h('span', { class: 'logo', style: { width: `${size}px`, height: `${size}px` } });
  wrap.innerHTML = `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <defs>
      <linearGradient id="lg-${size}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/>
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="16" fill="url(#lg-${size})"/>
    <g transform="translate(64,0) scale(-1,1)" fill="none" stroke="#fff" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 48V16h13a9 9 0 0 1 0 18H21"/><path d="M35 34l11 14"/>
    </g>
  </svg>`;
  return wrap;
}
