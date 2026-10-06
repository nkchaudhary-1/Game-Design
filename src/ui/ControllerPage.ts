// Controller-only page (?role=controller): the pad on its own, talking to the arena tab over a
// BroadcastChannel. This is the PRD's Phase 2 shape — "phone = controller, big screen = display" — with the
// browser's channel standing in for the relay. Nothing in the pad or the match changes: only the transport.

import { buildBlade } from '../blades/BladeFactory';
import { ChannelBus } from '../core/InputBus';
import { PART_SLOTS, type Build } from '../core/types';
import { ControllerPad } from './ControllerPad';
import { h } from './dom';

export function controllerUrl(bladeId: string, level: number, build: Build, superId: string | null): string {
  const q = new URLSearchParams({ role: 'controller', you: bladeId, level: String(level), build: PART_SLOTS.map((k) => build[k]).join(','), sup: superId ?? '' });
  return `${location.pathname}?${q.toString()}`;
}

export function mountControllerPage(root: HTMLElement, q: URLSearchParams): void {
  const parts = (q.get('build') ?? '').split(',');
  const build: Partial<Build> = {};
  PART_SLOTS.forEach((k, i) => { if (parts[i]) build[k] = parts[i]; });
  const built = buildBlade(q.get('you') ?? 'ravok', { level: Number(q.get('level')) || 3, build, equippedSuper: q.get('sup') || null });

  const bus = new ChannelBus();
  const t = bus.controllerSide();
  const pad = new ControllerPad({ slot: 0, built, send: (m) => t.send(m) });
  const status = h('div.status', null, 'Waiting for the arena tab…');
  let last = 0;

  t.subscribe((m) => {
    if (m.t !== 'feedback') return;
    last = performance.now();
    status.textContent = 'Connected to arena';
    status.classList.add('on');
    pad.feedback(m);
  });
  setInterval(() => {
    if (last && performance.now() - last > 2000) { status.textContent = 'Arena tab not responding'; status.classList.remove('on'); }
  }, 500);

  root.replaceChildren(h('div.controller-page', null, status, h('div.pad-wrap', null, pad.el)));
}
