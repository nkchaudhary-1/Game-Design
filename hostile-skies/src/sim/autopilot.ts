// A scripted pilot for an *assisted* aircraft. It drives the title-screen dogfight, the demo mode and the headless
// tests: bank towards the selected hostile, pull to turn, shoot when lined up (with lead), fire a missile on lock, and
// keep clear of the ground and the arena edge. `combat` turns harder and holds full throttle; `cinematic` is smoother.

import { Vector3 } from 'three';
import { bankAngle, headingAngle, MAX_BANK, pitchAngle } from './aircraft';
import { newControls, type Controls } from './controls';
import { isTargetable } from './aliens';
import { clamp, wrapPi } from './util';
import { CANNON, type World } from './world';

const _aim = new Vector3(), _d = new Vector3(), _f = new Vector3();

export function autopilot(w: World, style: 'combat' | 'cinematic' = 'combat'): Controls {
  const c = newControls();
  const ac = w.ac;
  const hard = style === 'combat';
  c.throttleSet = hard ? 1 : 0.8;

  // ground ahead: wings level and pull
  if (w.tti < 3.5) {
    c.pitch = 1;
    c.roll = 0;
    return c;
  }

  // the sim's own target choice keeps lock-on and steering pointed at the same ship
  let tgt = w.target && isTargetable(w.target) ? w.target : null;
  if (!tgt) {
    let bd = Infinity;
    for (const a of w.aliens) {
      if (!isTargetable(a) || (a.kind === 'core' && a.shielded)) continue;
      const d = a.pos.distanceTo(ac.pos);
      if (d < bd) { bd = d; tgt = a; }
    }
  }

  let dist = 0;
  let engaging = false;
  if (Math.hypot(ac.pos.x, ac.pos.z) > 7000) _aim.set(0, 1300, 0);
  else if (tgt) {
    dist = tgt.pos.distanceTo(ac.pos);
    // lead the shot: where the target will be when a round (or the aircraft) gets there
    const t = dist < 1500 ? dist / (CANNON.speed + 100) : 0;
    _aim.copy(tgt.pos).addScaledVector(_d.copy(tgt.vel).sub(ac.vel), t);
    engaging = true;
  } else {
    c.pitch = ac.pos.y < 700 ? 0.6 : 0;
    return c;
  }

  _d.copy(_aim).sub(ac.pos);
  const range = _d.length();
  const wantHdg = Math.atan2(_d.x, -_d.z);
  const wantPitch = clamp(Math.asin(clamp(_d.y / Math.max(range, 1), -1, 1)), -0.6, 0.7);
  const hErr = wrapPi(wantHdg - headingAngle(ac));
  const pErr = wantPitch - pitchAngle(ac);

  // assisted roll commands a bank angle: bank into the turn in proportion to how far round the target is, pull to
  // turn, and use a little rudder for the final aim
  c.roll = clamp((hErr * (hard ? 2.4 : 1.4)) / MAX_BANK, -1, 1);
  if (Math.abs(hErr) > 0.1) c.pitch = clamp(Math.abs(hErr) * (hard ? 3 : 1.8) * (Math.abs(bankAngle(ac)) > 0.3 ? 1 : 0.4) + pErr * 0.5, -0.5, hard ? 1 : 0.75);
  else c.pitch = clamp(pErr * 4, -0.7, 0.9);
  c.yaw = Math.abs(hErr) < 0.35 ? clamp(hErr * 3, -1, 1) : 0;

  // far from the fight: burn
  if (engaging && dist > 2600) c.boost = true;
  if (engaging && dist < 350 && Math.abs(hErr) > 0.5) c.brake = true;

  // true angle off the nose, not the heading error alone
  _f.set(0, 0, -1).applyQuaternion(ac.q);
  const off = Math.acos(clamp(_f.dot(_d.normalize()), -1, 1));
  // shoot when the error cone is about the size of the target at that range
  c.fire = engaging && range < 1000 && off < clamp((hard ? 30 : 20) / Math.max(range, 100), 0.02, 0.08) + w.aimAssist * 0.07;
  c.missile = w.lock >= 1;
  return c;
}
