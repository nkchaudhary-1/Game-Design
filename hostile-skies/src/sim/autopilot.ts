// A simple scripted pilot for an *assisted* aircraft. It drives the title-screen dogfight and the headless tests:
// bank towards the nearest hostile, pull to turn, shoot when lined up, fire a missile on lock, and keep clear of the
// ground and the arena edge. `combat` turns harder and holds full throttle; `cinematic` is smoother for the title shot.

import { Vector3 } from 'three';
import { bankAngle, headingAngle, MAX_BANK, pitchAngle } from './aircraft';
import { newControls, type Controls } from './controls';
import { clamp, wrapPi } from './util';
import type { World } from './world';

const _aim = new Vector3(), _d = new Vector3();

export function autopilot(w: World, style: 'combat' | 'cinematic' = 'combat'): Controls {
  const c = newControls();
  const ac = w.ac;
  const hard = style === 'combat';
  c.throttleSet = hard ? 1 : 0.75;

  // ground ahead: wings level and pull
  if (w.tti < 3.5) {
    c.pitch = 1;
    c.roll = 0;
    return c;
  }

  let have = false;
  if (Math.hypot(ac.pos.x, ac.pos.z) > 7000) { _aim.set(0, 1300, 0); have = true; }
  else {
    let bd = Infinity;
    for (const a of w.aliens) {
      if (a.dying > 0 || a.kind === 'mothership' || (a.kind === 'core' && a.shielded)) continue;
      const d = a.pos.distanceTo(ac.pos);
      if (d < bd) { bd = d; _aim.copy(a.pos); have = true; }
    }
  }
  if (!have) { c.pitch = ac.pos.y < 700 ? 0.6 : 0; return c; }

  _d.copy(_aim).sub(ac.pos);
  const dist = _d.length();
  const wantHdg = Math.atan2(_d.x, -_d.z);
  const wantPitch = clamp(Math.asin(clamp(_d.y / Math.max(dist, 1), -1, 1)), -0.6, 0.7);
  const hErr = wrapPi(wantHdg - headingAngle(ac));
  const pErr = wantPitch - pitchAngle(ac);

  // assisted roll commands a bank angle: bank into the turn in proportion to how far round the target is, pull to
  // turn, and use a little rudder for the final aim
  c.roll = clamp((hErr * (hard ? 2.4 : 1.4)) / MAX_BANK, -1, 1);
  if (Math.abs(hErr) > 0.1) c.pitch = clamp(Math.abs(hErr) * (hard ? 3 : 1.8) * (Math.abs(bankAngle(ac)) > 0.3 ? 1 : 0.4) + pErr * 0.5, -0.5, hard ? 1 : 0.75);
  else c.pitch = clamp(pErr * 4, -0.7, 0.9);
  c.yaw = Math.abs(hErr) < 0.35 ? clamp(hErr * 3, -1, 1) : 0;

  c.fire = Math.abs(hErr) < 0.08 && Math.abs(pErr) < 0.09 && dist < 1000;
  c.missile = w.lock >= 1;
  return c;
}
