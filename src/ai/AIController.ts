// CPU brain, part 2: what each state does. The CPU is a controller like any other: it sends
// ControllerMsgs (steer, move down/up, super) and nothing else.

import { clamp, lerp } from '../core/types';
import type { ControllerMsg } from '../core/InputBus';
import type { Rng } from '../core/Rng';
import type { BladeRuntime } from '../blades/Blade';
import type { EffectDef } from '../blades/effects';
import { getSuper } from '../blades/supers';
import type { Match } from '../combat/Match';
import { AI_PARAMS, AI_RANGE, chooseState, matchup, type AIContext, type AIDifficulty, type AIState } from './AIStates';

const norm = (x: number, z: number, fx = 0, fz = 0): [number, number] => {
  const l = Math.hypot(x, z);
  return l < 1e-6 ? [fx, fz] : [x / l, z / l];
};

/** Is this Super mainly an attack, a defence or a utility? Read from its effects, not from a blade id. */
export function superIntent(superId: string): 'offense' | 'defense' | 'utility' {
  const def = getSuper(superId);
  let off = 0, defn = 0;
  const score = (e: EffectDef) => {
    switch (e.kind) {
      case 'dash': case 'radial': case 'slam': case 'teleport': case 'pull': case 'drain': off += 2; break;
      case 'zone': off += e.zone === 'trap' ? 1 : 2; break;
      case 'mod':
        if (e.target === 'opponent') off += 2;
        if (e.mods && ((e.mods.dmgTaken ?? 1) < 1 || (e.mods.kbTaken ?? 1) < 1 || (e.mods.mass ?? 1) > 1)) defn += 2;
        if (e.mods && ((e.mods.dmgDealt ?? 1) > 1 || (e.mods.kbDealt ?? 1) > 1)) off += 1;
        if (e.flags?.includes('reflectDamage') || e.flags?.includes('reflectKnockback')) defn += 2;
        if (e.spinLoss) defn += 1;
        break;
      case 'shield': defn += 3; break;
      default: break;
    }
  };
  def.effects.forEach((t) => score(t.effect));
  if (off === 0 && defn === 0) return 'utility';
  return off >= defn ? 'offense' : 'defense';
}

export class AIController {
  state: AIState = 'SEARCH';
  private thinkIn = 0;
  private sx = 0;
  private sz = 0;
  private aggressive = true;
  private aggressiveUntil = 0;
  private chargeFor = 0;       // seconds left on a charge we started
  private chargeIndex = -1;
  private superReadySince = -1;
  private clock = 0;

  constructor(
    readonly slot: number,
    readonly difficulty: AIDifficulty,
    private readonly send: (msg: ControllerMsg) => void,
    private readonly rng: Rng,
  ) {}

  /** Choose the opening launch (the CPU launches when the player does). */
  launch(match: Match): { angle: number; power: number } {
    const me = match.blades[this.slot];
    const opp = match.opponentOf(this.slot);
    const base = opp ? Math.atan2(opp.z - me.z, opp.x - me.x) : -Math.PI / 2;
    const cls = me.built.def.class;
    const p = AI_PARAMS[this.difficulty];
    const power = { ATTACK: 0.85, DEFENSE: 0.4, STAMINA: 0.55 }[cls];
    // evaders leave off-axis so the opening clash isn't a coin flip
    const off = cls === 'STAMINA' ? (this.rng() < 0.5 ? -1 : 1) * (0.7 + this.rng() * 0.3) : (this.rng() - 0.5) * (0.2 + p.noise);
    return { angle: base + off, power: clamp(power + (this.rng() - 0.5) * 0.2, 0.2, 1) };
  }

  update(match: Match, dt: number): void {
    const me = match.blades[this.slot];
    if (!me || !me.launched || !me.alive || match.phase !== 'live') { this.release(match, me); return; }
    this.clock += dt;
    this.thinkIn -= dt;
    this.tickCharge(dt);
    if (this.thinkIn <= 0) {
      const p = AI_PARAMS[this.difficulty];
      this.thinkIn = p.period * (0.8 + 0.4 * this.rng());
      this.decide(match, me);
    }
    // smooth the steering so it doesn't jitter
    this.send({ t: 'steer', slot: this.slot, x: this.sx, z: this.sz });
  }

  // ------------------------------------------------------------------------------------------ decide
  private decide(match: Match, me: BladeRuntime): void {
    const p = AI_PARAMS[this.difficulty];
    const target = this.targetFor(match, me);
    if (!target) { this.sx = 0; this.sz = 0; return; }
    const opp = match.opponentOf(this.slot);
    if (!opp) { this.sx = 0; this.sz = 0; return; }
    const R = match.arena.radius;
    const cls = me.built.def.class;
    const oppCls = opp.built.def.class;
    const dx = target.x - me.x, dz = target.z - me.z;
    const dist = Math.hypot(dx, dz) || 1;
    const myD = Math.hypot(me.x, me.z) || 0.001;
    const outward = (me.vx * me.x + me.vz * me.z) / myD;
    const closing = ((opp.vx * (me.x - opp.x) + opp.vz * (me.z - opp.z)) / (Math.hypot(me.x - opp.x, me.z - opp.z) || 1));

    // matchup decides how willing it is to trade hits; re-rolled every few seconds
    if (this.clock >= this.aggressiveUntil) {
      const m = matchup(cls, oppCls);
      const base = m === 'ADVANTAGE' ? 0.95 : m === 'EVEN' ? 0.8 : 0.45;
      this.aggressive = this.rng() < base * (0.6 + 0.4 * p.skill);
      this.aggressiveUntil = this.clock + 2.5 + this.rng() * 2.5;
    }

    const wantsSuper = this.wantsSuper(match, me, dist, opp);
    const ctx: AIContext = {
      cls, oppCls, dist, myD, outward, closing, mySpin: me.spin, oppSpin: opp.spin,
      superReady: me.superState === 'READY' && !!me.superId, wantsSuper,
      sinceHurt: match.t - me.lastHurtAt, radius: R, hazardNear: false,
      stalled: match.t - Math.max(match.lastHit, 4) > 5.5,
    };
    this.state = chooseState(ctx, this.aggressive);

    let tx = 0, tz = 0;
    const cx = -me.x / myD, cz = -me.z / myD; // unit vector to the centre

    switch (this.state) {
      case 'USE_SUPER': {
        this.send({ t: 'super', slot: this.slot });
        [tx, tz] = this.approach(me, target, 0.3);
        break;
      }
      case 'EDGE_AVOID': {
        tx = cx; tz = cz;
        if (this.canUse(me, 1) && me.built.moves[1].type === 'DEFENSE' && dist < R * 0.25) this.tap(1);
        break;
      }
      case 'LOW_SPIN': {
        // conserve what's left: stay out of the way, unless the opponent is as low and a hit would finish it
        if (matchup(cls, oppCls) === 'ADVANTAGE' && opp.spin < me.spin + 5) [tx, tz] = this.approach(me, target, 0.3);
        else { tx = cx * 0.7; tz = cz * 0.7; this.orbit(me, target, 0.5); tx += this.ox; tz += this.oz; }
        break;
      }
      case 'RECOVER': {
        tx = cx * Math.min(1, myD / (R * 0.3)); tz = cz * Math.min(1, myD / (R * 0.3));
        this.defend(me, dist, closing);
        break;
      }
      case 'ATTACK': {
        [tx, tz] = this.approach(me, target, clamp(dist / (R * 0.5), 0.1, 1));
        this.attack(me, dist, p.skill);
        break;
      }
      case 'CHASE': {
        [tx, tz] = this.approach(me, target, clamp(dist / (R * 0.5), 0.1, 1.1));
        if (cls === 'ATTACK' && dist > R * 0.3 && dist < R * 0.9) this.mobility(me, target, 'toward', p.skill);
        break;
      }
      case 'EVADE': {
        const flee = clamp(1 - dist / (R * 0.55), 0, 1) * 1.5;
        this.orbit(me, target, 0.55);
        const rad = clamp((R * 0.4 - myD) / (R * 0.22), -1, 1);
        tx = -((target.x - me.x) / dist) * flee + this.ox - cx * rad;
        tz = -((target.z - me.z) / dist) * flee + this.oz - cz * rad;
        this.defend(me, dist, closing);
        if (dist < R * 0.45) this.mobility(me, target, 'away', p.skill);
        // hit-and-run: a quiet target is worth a dart
        if (dist < R * 0.75 && Math.hypot(opp.vx, opp.vz) < 4.6 && this.rng() < 0.04 * p.skill) [tx, tz] = this.approach(me, target, 0.2);
        break;
      }
      case 'SEARCH':
      default: {
        if (cls === 'DEFENSE') { const k = Math.min(1, myD / (R * 0.18)); tx = cx * k; tz = cz * k; this.defend(me, dist, closing); }
        else if (cls === 'STAMINA') { this.orbit(me, target, 0.5); const rad = clamp((R * 0.4 - myD) / (R * 0.22), -1, 1); tx = this.ox - cx * rad; tz = this.oz - cz * rad; }
        else { [tx, tz] = this.approach(me, target, 0.5); }
        break;
      }
    }

    // never wander over the rim
    const edge = clamp((myD - R * AI_RANGE.edge) / (R * 0.12), 0, 1);
    tx = lerp(tx, cx, edge); tz = lerp(tz, cz, edge);
    const l = Math.hypot(tx, tz);
    if (l > 1) { tx /= l; tz /= l; }
    const a = (this.rng() - 0.5) * 2 * p.noise;
    const ca = Math.cos(a), sa = Math.sin(a);
    this.sx += (tx * ca - tz * sa - this.sx) * 0.55;
    this.sz += (tx * sa + tz * ca - this.sz) * 0.55;
  }

  // ------------------------------------------------------------------------------------------ helpers
  private ox = 0;
  private oz = 0;

  /** What the CPU believes its opponent is: a Phantom's decoy fools it, stealth blurs it. */
  private targetFor(match: Match, me: BladeRuntime): { x: number; z: number; vx: number; vz: number } | null {
    const opp = match.opponentOf(this.slot);
    if (!opp) return null;
    const decoy = match.decoys.find((d) => d.owner === opp.slot);
    if (decoy && this.rng() < 0.85) return { x: decoy.x, z: decoy.z, vx: decoy.vx, vz: decoy.vz };
    if (opp.hasFlag('stealth')) {
      const j = (1 - AI_PARAMS[this.difficulty].skill * 0.5) * 3 + 1.2;
      return { x: opp.x + (this.rng() - 0.5) * j * 2, z: opp.z + (this.rng() - 0.5) * j * 2, vx: opp.vx, vz: opp.vz };
    }
    void me;
    return { x: opp.x, z: opp.z, vx: opp.vx, vz: opp.vz };
  }

  /** Aim just inside the target (centre side) so a hit pushes it towards the wall. */
  private approach(me: BladeRuntime, t: { x: number; z: number; vx: number; vz: number }, leadT: number): [number, number] {
    const dx = t.x + t.vx * leadT - me.x, dz = t.z + t.vz * leadT - me.z;
    const dist = Math.hypot(dx, dz) || 1;
    let tx = dx / dist, tz = dz / dist;
    const tD = Math.hypot(t.x, t.z);
    if (tD > 3.4) {
      const k = (me.radius + 1.4 + 0.96) / tD;
      const ix = t.x * (1 - k) + t.vx * leadT * 0.5 - me.x, iz = t.z * (1 - k) + t.vz * leadT * 0.5 - me.z;
      const il = Math.hypot(ix, iz) || 1;
      const w = clamp((dist - 4.1) / 4.3, 0, 1);
      tx = lerp(tx, ix / il, w); tz = lerp(tz, iz / il, w);
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    }
    return [tx, tz];
  }

  /** Tangent direction that circles away from the target. Stores into (ox, oz). */
  private orbit(me: BladeRuntime, t: { x: number; z: number }, weight: number): void {
    const myD = Math.hypot(me.x, me.z) || 1;
    const tgx = -me.z / myD, tgz = me.x / myD;
    const dx = t.x - me.x, dz = t.z - me.z;
    const sgn = tgx * dx + tgz * dz > 0 ? -1 : 1;
    this.ox = tgx * sgn * weight; this.oz = tgz * sgn * weight;
  }

  private canUse(me: BladeRuntime, i: number): boolean { return me.cooldown[i] <= 0; }
  private tap(i: 0 | 1 | 2): void {
    this.send({ t: 'move', slot: this.slot, index: i, phase: 'down' });
    this.send({ t: 'move', slot: this.slot, index: i, phase: 'up' });
  }

  /** Move 1: hold to charge, release when charged enough or on top of the target. */
  private attack(me: BladeRuntime, dist: number, skill: number): void {
    if (this.chargeIndex >= 0 || me.cooldown[0] > 0 || this.rng() > skill) return;
    const ab = me.built.moves[0];
    if (!ab.charge) { this.tap(0); return; }
    this.chargeIndex = 0;
    this.chargeFor = ab.charge.maxTime * AI_PARAMS[this.difficulty].chargeFrac * clamp(0.55 + dist / 8, 0.5, 1);
    this.send({ t: 'move', slot: this.slot, index: 0, phase: 'down' });
  }

  private tickCharge(dt: number): void {
    if (this.chargeIndex < 0) return;
    this.chargeFor -= dt;
    if (this.chargeFor <= 0) {
      this.send({ t: 'move', slot: this.slot, index: 0, phase: 'up' });
      this.chargeIndex = -1;
    }
  }

  /** Move 2: defensive / evasive, when something is about to land. */
  private defend(me: BladeRuntime, dist: number, closing: number): void {
    if (!this.canUse(me, 1) || this.rng() > AI_PARAMS[this.difficulty].skill) return;
    if (dist < 6.2 && closing > 3.6) this.tap(1);
    else if (me.built.moves[2].type === 'BUFF' && this.canUse(me, 2) && dist < 5 && me.built.def.class === 'DEFENSE') this.tap(2);
  }

  /** Move 3: movement burst, towards (attackers) or away from (evaders) the target. */
  private mobility(me: BladeRuntime, t: { x: number; z: number }, dir: 'toward' | 'away', skill: number): void {
    if (!this.canUse(me, 2) || this.rng() > skill * 0.5) return;
    const ab = me.built.moves[2];
    if (ab.type !== 'MOVEMENT' && !(dir === 'away' && ab.type === 'BUFF')) return;
    // steer the way we want to burst, then tap
    const [dx, dz] = norm(t.x - me.x, t.z - me.z);
    this.sx = dir === 'toward' ? dx : -dx; this.sz = dir === 'toward' ? dz : -dz;
    this.send({ t: 'steer', slot: this.slot, x: this.sx, z: this.sz });
    this.tap(2);
  }

  private wantsSuper(match: Match, me: BladeRuntime, dist: number, opp: BladeRuntime): boolean {
    if (me.superState !== 'READY' || !me.superId) return false;
    if (this.superReadySince < 0) this.superReadySince = this.clock;
    if (this.clock - this.superReadySince < AI_PARAMS[this.difficulty].superDelay) return false;
    const R = match.arena.radius;
    const intent = superIntent(me.superId);
    let want = false;
    if (intent === 'offense') want = dist < R * 0.7 && me.spin > 18;
    else if (intent === 'defense') want = (dist < R * 0.4 && opp.speed > 3) || me.spin < 40;
    else want = dist < R * 0.6;
    if (want) this.superReadySince = -1;
    return want;
  }

  /** Let go of everything (match over, blade out). */
  private release(match: Match, me: BladeRuntime | undefined): void {
    if (this.chargeIndex >= 0) {
      this.send({ t: 'move', slot: this.slot, index: 0, phase: 'up' });
      this.chargeIndex = -1;
    }
    if (me && match.phase !== 'live') this.send({ t: 'steer', slot: this.slot, x: 0, z: 0 });
  }
}
