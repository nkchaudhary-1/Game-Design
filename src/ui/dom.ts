// Tiny DOM helpers + the icon set. No framework: screens are plain classes that build their DOM once and
// patch it on change.

type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

/** h('button.btn.primary', { onclick }, 'Go') — tag, optional .classes / #id, attributes, children. */
export function h(sel: string, attrs: Attrs | null = null, ...kids: Child[]): HTMLElement {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel);
  const tag = (m?.[1] ?? 'div') as keyof HTMLElementTagNameMap;
  const el = document.createElement(tag);
  for (const part of (m?.[2] ?? '').match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, kids);
  return el;
}

export function canvasEl(cls = ''): HTMLCanvasElement {
  const c = document.createElement('canvas');
  if (cls) c.className = cls;
  return c;
}

export function append(el: Element, kids: Child[]): void {
  for (const k of kids) {
    if (k === false || k === null || k === undefined) continue;
    el.append(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
  }
}

export function clear(el: Element): void { while (el.firstChild) el.removeChild(el.firstChild); }

export function svg(inner: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${inner}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}

/** Icon paths (24×24, stroke style). Sharp geometry to match the UI. */
export const ICON = {
  back: '<path d="M15 5 8 12l7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="m16 9 5 6M21 9l-5 6"/>',
  strike: '<path d="M12 2l2.4 6.6L21 9l-5 4.4L17.6 21 12 17.2 6.4 21 8 13.4 3 9l6.6-.4z"/>',
  guard: '<path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z"/>',
  dash: '<path d="M4 6l7 6-7 6M12 6l7 6-7 6"/>',
  control: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  buff: '<path d="M12 21V8M6 13l6-6 6 6M6 6h12"/>',
  debuff: '<path d="M12 3v13M6 11l6 6 6-6M6 20h12"/>',
  super: '<path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor"/>',
  ring: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><path d="M16 8l5-5M21 3v5M21 3h-5"/>',
  spin: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7a5 5 0 1 0 5 5"/><path d="M21 3v6h-6" />',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  double: '<path d="M5 5l6 6M11 5l-6 6M13 13l6 6M19 13l-6 6"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v5h-5"/>',
  top: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>',
  side: '<path d="M4 17h16M7 17l5 4 5-4M6 13h12v4H6zM9 9h6v4H9z"/>',
  cube: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9zM4 7.5 12 12l8-4.5M12 12v9"/>',
  lock: '<rect x="5" y="11" width="14" height="10"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  wrench: '<path d="M14 6a4 4 0 0 0 5 5l-9 9-4-4 9-9z" />',
  phone: '<rect x="7" y="2" width="10" height="20"/><path d="M11 18h2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.5"/>',
} as const;

export function icon(name: keyof typeof ICON, size?: number): SVGSVGElement {
  const s = svg(ICON[name]);
  if (size) { s.setAttribute('width', String(size)); s.setAttribute('height', String(size)); }
  return s;
}

export function abilityIcon(type: string): keyof typeof ICON {
  switch (type) {
    case 'ATTACK': return 'strike';
    case 'DEFENSE': return 'guard';
    case 'MOVEMENT': return 'dash';
    case 'CONTROL': return 'control';
    case 'BUFF': return 'buff';
    case 'DEBUFF': return 'debuff';
    default: return 'strike';
  }
}

export const cap = (s: string): string => s.charAt(0) + s.slice(1).toLowerCase();
