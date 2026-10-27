// The player's jet: a rate-commanded aircraft with real aerodynamic forces.
//
// The pilot commands body rotation rates (like a fly-by-wire fighter). The rest is physics: lift, induced drag, stall,
// thrust, gravity and sideslip all act on the velocity vector, so energy is spent in hard turns, the nose can outrun
// the flight path, and a slow aircraft really does fall out of the sky. "Assist" adds the fly-by-wire helpers
// (auto-level, coordinated turns, an angle-of-attack limiter); "Manual" strips them away.

import { Quaternion, Vector3 } from 'three';
import type { Controls } from './controls';
import { clamp, DEG, damp, G, lerp, smoothstep, wrapPi } from './util';

export const JET = {
  mass: 9000,
  wingArea: 56,
  thrustMil: 75_000,
  thrustAb: 135_000,
  cd0: 0.032,
  inducedK: 0.075,
  clAlpha: 5.2,
  aoaStall: 16 * DEG,
  clMax: 1.45,
  gLimit: 12,
  rollRate: 3.1,
  yawRate: 0.55,
  /** Collision radius used against alien fire and ramming. */
  radius: 9,
} as const;

/** Assisted flight: the bank angle at full stick. */
export const MAX_BANK = 80 * DEG;

export interface Aircraft {
  pos: Vector3;
  vel: Vector3;
  /** Body-to-world. Body axes: forward -Z, up +Y, right +X. */
  q: Quaternion;
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  /** Throttle lever 0..1. */
  throttle: number;
  /** Afterburner fuel 0..100. */
  boostFuel: number;
  boosting: boolean;
  boostLock: boolean;
  boostIdle: number;
  // ---- derived each step (read by HUD, audio, camera) ----
  speed: number;
  aoa: number;
  beta: number;
  g: number;
  stalled: boolean;
  braking: boolean;
  /** Smoothed engine output 0..1.3 (1.3 = full afterburner). */
  thrust: number;
}

export function newAircraft(x: number, y: number, z: number, speed = 190): Aircraft {
  return {
    pos: new Vector3(x, y, z),
    vel: new Vector3(0, 0, -speed),
    q: new Quaternion(),
    pitchRate: 0, rollRate: 0, yawRate: 0,
    throttle: 0.55, boostFuel: 100, boosting: false, boostLock: false, boostIdle: 0,
    speed, aoa: 0, beta: 0, g: 1, stalled: false, braking: false, thrust: 0.55,
  };
}

const _f = new Vector3(), _u = new Vector3(), _r = new Vector3(), _vh = new Vector3();
const _lift = new Vector3(), _acc = new Vector3(), _dq = new Quaternion(), _w = new Vector3();

export const airDensity = (alt: number): number => 1.225 * Math.exp(-Math.max(alt, 0) / 8500);

/** Lift coefficient vs angle of attack: linear up to the stall, then a sharp drop to a draggy plateau. */
export function liftCoef(aoa: number): number {
  const a = Math.abs(aoa), s = aoa < 0 ? -1 : 1;
  if (a <= JET.aoaStall) return s * JET.clAlpha * a;
  const over = smoothstep(0, 1, (a - JET.aoaStall) / (12 * DEG));
  const fade = 1 - smoothstep(50 * DEG, 100 * DEG, a);
  return s * lerp(JET.clMax, 0.5, over) * fade;
}

export function bankAngle(a: Aircraft): number {
  _r.set(1, 0, 0).applyQuaternion(a.q);
  _u.set(0, 1, 0).applyQuaternion(a.q);
  return Math.atan2(-_r.y, _u.y);
}
export function pitchAngle(a: Aircraft): number {
  _f.set(0, 0, -1).applyQuaternion(a.q);
  return Math.asin(clamp(_f.y, -1, 1));
}
/** Compass heading in radians, 0 = north (-z), clockwise. */
export function headingAngle(a: Aircraft): number {
  _f.set(0, 0, -1).applyQuaternion(a.q);
  return Math.atan2(_f.x, -_f.z);
}
export const forwardOf = (a: Aircraft, out: Vector3): Vector3 => out.set(0, 0, -1).applyQuaternion(a.q);

export function stepAircraft(a: Aircraft, c: Controls, dt: number, assist: boolean): void {
  _f.set(0, 0, -1).applyQuaternion(a.q);
  _u.set(0, 1, 0).applyQuaternion(a.q);
  _r.set(1, 0, 0).applyQuaternion(a.q);

  const V = a.vel.length();
  a.speed = V;
  const vf = a.vel.dot(_f), vu = a.vel.dot(_u), vr = a.vel.dot(_r);
  a.aoa = V > 6 ? Math.atan2(-vu, vf) : 0;
  a.beta = V > 6 ? Math.atan2(vr, Math.max(Math.abs(vf), 1)) : 0;
  const rho = airDensity(a.pos.y);
  const qbar = 0.5 * rho * V * V;
  const qS = qbar * JET.wingArea;
  const pitch = Math.asin(clamp(_f.y, -1, 1));
  const bank = Math.atan2(-_r.y, _u.y);

  // ---- throttle, afterburner ------------------------------------------------------------------------------------
  if (c.throttleSet !== null) a.throttle = clamp(c.throttleSet, 0, 1);
  else a.throttle = clamp(a.throttle + c.throttleDelta * 0.5 * dt, 0, 1);
  if (a.boostFuel < 8) a.boostLock = true;
  if (a.boostFuel > 30) a.boostLock = false;
  a.boosting = c.boost && !a.boostLock && a.boostFuel > 0;
  if (a.boosting) {
    a.boostFuel = Math.max(0, a.boostFuel - 24 * dt);
    a.boostIdle = 0;
  } else {
    a.boostIdle += dt;
    if (a.boostIdle > 1.2) a.boostFuel = Math.min(100, a.boostFuel + 9 * dt);
  }
  a.braking = c.brake;
  const target = a.boosting ? 1.3 : a.throttle;
  a.thrust += (target - a.thrust) * damp(a.boosting ? 4 : 1.6, dt);

  // ---- aerodynamic forces ---------------------------------------------------------------------------------------
  const cl = liftCoef(a.aoa);
  const absA = Math.abs(a.aoa);
  let cd = JET.cd0 + JET.inducedK * cl * cl + 1.0 * Math.sin(Math.min(absA, Math.PI / 2)) ** 2 * smoothstep(12 * DEG, 45 * DEG, absA);
  cd += 0.5 * Math.sin(Math.min(Math.abs(a.beta), Math.PI / 2)) ** 2;
  if (c.brake) cd += 0.13;

  a.stalled = absA > JET.aoaStall * 1.02 || V < 48;

  _acc.set(0, -G, 0);
  if (V > 0.5) {
    _vh.copy(a.vel).multiplyScalar(1 / V);
    // lift acts perpendicular to the flight path, in the plane of the wings' "up"
    _lift.copy(_u).addScaledVector(_vh, -_u.dot(_vh));
    const ll = _lift.length();
    if (ll > 1e-3) {
      _lift.multiplyScalar(1 / ll);
      const L = qS * cl;
      _acc.addScaledVector(_lift, L / JET.mass);
      a.g = (L * _lift.dot(_u)) / (JET.mass * G);
    } else a.g = 0;
    _acc.addScaledVector(_vh, -(qS * cd) / JET.mass);
    // fin and fuselage side force: resists sideslip
    _acc.addScaledVector(_r, -(qS * 1.6 * clamp(a.beta, -0.5, 0.5)) / JET.mass);
  }
  const dens = lerp(1, rho / 1.225, 0.6);
  const thrust = a.thrust <= 1 ? JET.thrustMil * a.thrust : JET.thrustMil + (JET.thrustAb - JET.thrustMil) * ((a.thrust - 1) / 0.3);
  _acc.addScaledVector(_f, (thrust * dens) / JET.mass);

  a.vel.addScaledVector(_acc, dt);
  if (a.vel.length() > 650) a.vel.setLength(650);
  a.pos.addScaledVector(a.vel, dt);

  // ---- attitude: commanded rates ---------------------------------------------------------------------------------
  const auth = 0.15 + 0.85 * smoothstep(32, 110, V);
  const vSafe = Math.max(V, 70);
  const pitchUpMax = Math.min(1.25, (JET.gLimit * G) / vSafe) * auth;
  const pitchDownMax = Math.min(1.0, (5 * G) / vSafe) * auth;

  let pCmd = c.pitch >= 0 ? c.pitch * pitchUpMax : c.pitch * pitchDownMax;
  const free = 1 - Math.min(1, Math.abs(c.pitch) * 1.5);

  // static stability: the nose tends to follow the flight path towards the AoA that carries 1 g (or n g in a bank)
  const cosBank = Math.max(Math.abs(Math.cos(bank)), 0.3) * (Math.cos(bank) < 0 ? 0.3 : 1);
  const aoaTrim = clamp((assist ? 1.04 : 1) * (JET.mass * G * Math.cos(pitch)) / (Math.max(qS, 1) * JET.clAlpha) / Math.max(cosBank, 0.3), 0, JET.aoaStall * 0.85);
  // assist also eases the flight path back towards level when the stick is released
  const gamma = V > 20 ? Math.asin(clamp(a.vel.y / V, -1, 1)) : 0;
  const aoaGoal = assist
    ? aoaTrim + clamp(-gamma * 1.6, -7 * DEG, 7 * DEG) * smoothstep(75 * DEG, 50 * DEG, Math.abs(gamma))
    : aoaTrim;
  pCmd -= (assist ? 0.9 : 0.3) * free * (a.aoa - aoaGoal);

  // angle-of-attack limiter (assist) / stall departure (manual)
  if (assist) {
    if (pCmd > 0) pCmd *= 1 - smoothstep(0.7 * JET.aoaStall, 0.97 * JET.aoaStall, a.aoa);
    pCmd -= 0.7 * smoothstep(0.92 * JET.aoaStall, 1.3 * JET.aoaStall, a.aoa);
    pCmd -= 0.45 * (1 - smoothstep(35, 62, V));
  } else {
    pCmd -= 0.95 * smoothstep(JET.aoaStall, 1.6 * JET.aoaStall, a.aoa);
    pCmd -= 0.7 * (1 - smoothstep(35, 62, V));
  }

  let rCmd = c.roll * JET.rollRate * Math.max(auth, 0.35);
  let yCmd = c.yaw * JET.yawRate * auth;
  yCmd += (assist ? 1.5 : 0.8) * a.beta;

  if (assist) {
    // roll input commands a bank ANGLE (up to MAX_BANK), so a turn can be held and releasing the stick levels the wings.
    // Bank is only well-defined away from the vertical, so near a loop's apex it falls back to a plain roll rate.
    const hold = smoothstep(80 * DEG, 60 * DEG, Math.abs(pitch));
    const bankRate = clamp(wrapPi(c.roll * MAX_BANK - bank) * 2.8, -JET.rollRate, JET.rollRate) * Math.max(auth, 0.35);
    rCmd += (bankRate - rCmd) * hold;
    // coordinated turn: a banked wing needs a little pitch and yaw to hold altitude
    if (Math.abs(bank) < 85 * DEG && V > 40) {
      const tanB = Math.tan(bank), sinB = Math.sin(bank);
      pCmd += clamp((G * tanB * sinB) / V, 0, 0.8) * (1 - 0.7 * Math.abs(c.pitch));
      yCmd += clamp((G * sinB) / V, -0.6, 0.6);
    }
  }

  a.pitchRate += (pCmd - a.pitchRate) * damp(7, dt);
  a.rollRate += (rCmd - a.rollRate) * damp(6.5, dt);
  a.yawRate += (yCmd - a.yawRate) * damp(5, dt);

  _w.set(a.pitchRate, -a.yawRate, -a.rollRate);
  const w = _w.length();
  if (w > 1e-6) {
    _dq.setFromAxisAngle(_w.multiplyScalar(1 / w), w * dt);
    a.q.multiply(_dq).normalize();
  }
}
