// The heads-up display: one 2D canvas over the 3D view, redrawn every frame. Conformal where it matters (pitch ladder,
// boresight, velocity vector and target markers are projected through the real camera, so they sit on the world in
// both chase and cockpit views), plain screen-space elsewhere (tapes, radar, vitals, comms).
//
// Colour language: cyan = you and your instruments, amber = caution, red = hostile or danger, lime = alien tech.

import { Vector3 } from 'three';
import { bankAngle, forwardOf, headingAngle, pitchAngle } from '../sim/aircraft';
import { isTargetable, ALIEN_SPEC } from '../sim/aliens';
import { ARENA_RADIUS, surfaceHeight } from '../sim/terrain';
import { CANNON, MISSILE, WAVES, type SimEvent, type World } from '../sim/world';
import { clamp, DEG, smoothstep } from '../sim/util';
import type { GameView } from '../render/view';

const CY = '#6ff3ff';
const CY_DIM = 'rgba(111,243,255,0.42)';
const CY_FAINT = 'rgba(111,243,255,0.16)';
const AMBER = '#ffc04d';
const RED = '#ff5a4a';
const LIME = '#b6ff3c';
const WHITE = '#f2fbff';

export interface HudState {
  assist: boolean;
  mouseSteer: boolean;
  cockpit: boolean;
  mouse: { x: number; y: number };
  /** Seconds since the mission started (drives the first-flight hints). */
  missionTime: number;
  touch: boolean;
  /** Set while the demo reel is playing. */
  demo?: { title: string; caption: string };
}

interface Popup { text: string; pos: Vector3; age: number; color: string }
interface Msg { text: string; tone: string; age: number }

const _p = { x: 0, y: 0, behind: false };
const _v = new Vector3(), _w = new Vector3(), _f = new Vector3();

export class Hud {
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private u = 1;
  private compact = false;
  private t = 0;
  private popups: Popup[] = [];
  private msgs: Msg[] = [];
  private banner: { text: string; sub: string; age: number; sticky: boolean } | null = null;
  private hitMark = 0;
  private lastScore = 0;
  private scoreBump = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.compact = w < 900 || h < 520;
    this.u = clamp(h / 820, this.compact ? 0.62 : 0.8, 1.35);
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  reset(): void {
    this.popups.length = 0; this.msgs.length = 0; this.banner = null; this.hitMark = 0;
    this.lastScore = 0; this.scoreBump = 0;
  }

  consume(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'msg': this.msgs.push({ text: e.text, tone: e.tone, age: 0 }); if (this.msgs.length > 5) this.msgs.shift(); break;
        case 'wave':
          this.banner = e.phase === 'start'
            ? { text: `WAVE ${e.n}`, sub: e.title, age: 0, sticky: false }
            : { text: 'WAVE CLEAR', sub: `BONUS ${e.title}`, age: 0, sticky: false };
          break;
        case 'kill': this.popups.push({ text: `+${e.score}`, pos: e.pos.clone(), age: 0, color: e.kind === 'core' ? '#fff' : LIME }); break;
        case 'hit':
          if (e.target === 'alien' || e.target === 'hull') this.hitMark = 0.14;
          break;
        case 'win': this.banner = { text: 'LEVIATHAN DESTROYED', sub: 'THE CITIES ARE SAFE', age: 0, sticky: true }; break;
        default: break;
      }
    }
  }

  // ---- drawing helpers -------------------------------------------------------------------------------------------

  private text(s: string, x: number, y: number, size: number, color = CY, align: CanvasTextAlign = 'left', weight = 600, font = 'Chakra Petch'): void {
    const g = this.ctx;
    g.font = `${weight} ${Math.round(size * this.u)}px "${font}", "Rajdhani", system-ui, sans-serif`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(s, x, y);
  }

  private num(s: string, x: number, y: number, size: number, color = CY, align: CanvasTextAlign = 'left'): void {
    this.text(s, x, y, size, color, align, 600, 'Rajdhani');
  }

  private line(x1: number, y1: number, x2: number, y2: number, color = CY, width = 1.5): void {
    const g = this.ctx;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
    g.strokeStyle = color; g.lineWidth = width * this.u; g.stroke();
  }

  private circle(x: number, y: number, r: number, color = CY, width = 1.5, fill = false): void {
    const g = this.ctx;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { g.fillStyle = color; g.fill(); } else { g.strokeStyle = color; g.lineWidth = width * this.u; g.stroke(); }
  }

  private bracket(x: number, y: number, r: number, color: string, width = 2): void {
    const g = this.ctx, l = r * 0.42;
    g.strokeStyle = color; g.lineWidth = width * this.u;
    g.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      g.moveTo(x + sx * r, y + sy * (r - l)); g.lineTo(x + sx * r, y + sy * r); g.lineTo(x + sx * (r - l), y + sy * r);
    }
    g.stroke();
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, color: string, back = 'rgba(8,20,36,0.55)', segments = 0): void {
    const g = this.ctx;
    g.fillStyle = back; g.fillRect(x, y, w, h);
    g.fillStyle = color; g.fillRect(x, y, w * clamp(frac, 0, 1), h);
    g.strokeStyle = CY_FAINT; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (segments > 1) {
      g.fillStyle = 'rgba(5,12,24,0.8)';
      for (let i = 1; i < segments; i++) g.fillRect(x + (w * i) / segments - 0.5, y, 1.5, h);
    }
  }

  private proj(p: Vector3): { x: number; y: number; behind: boolean } {
    this.view!.project(p, _p);
    return _p;
  }

  private view: GameView | null = null;

  // ---- main ------------------------------------------------------------------------------------------------------

  draw(w: World, view: GameView, s: HudState, dt: number): void {
    this.view = view;
    this.t += dt;
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.lineCap = 'round'; g.lineJoin = 'round';

    this.vignettes(w);
    if (!w.playerAlive) { this.messages(dt); this.bannerDraw(dt); return; }

    this.ladder(w, view);
    this.gunsight(w);
    this.targets(w, view);
    this.incoming(w);
    if (s.mouseSteer) this.mouseStick(s);
    if (!this.compact) { this.tapes(w); this.headingTape(w); }
    else this.compactReadout(w);
    this.vitals(w);
    this.weapons(w);
    this.radar(w);
    this.topBar(w, dt);
    this.bossBar(w);
    this.warnings(w);
    this.messages(dt);
    this.popupsDraw(dt);
    this.bannerDraw(dt);
    this.hintsDraw(s);
    if (s.demo) this.demoChip(s.demo);
    else this.statusChips(s);
    this.hitMark = Math.max(0, this.hitMark - dt);
  }

  // ---- screen effects --------------------------------------------------------------------------------------------

  private vignettes(w: World): void {
    const g = this.ctx, { w: W, h: H } = this;
    const edge = (rgb: string, a: number) => {
      if (a <= 0.01) return;
      const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.hypot(W, H) * 0.56);
      gr.addColorStop(0, `rgba(${rgb},0)`); gr.addColorStop(1, `rgba(${rgb},${a})`);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    };
    // damage: red once the hull is hit, cyan flicker when only the shield soaked it
    const df = w.damageFlash;
    if (df > 0) edge(w.hull < 100 && w.shield <= 0 ? '255,40,30' : '60,200,255', df * 0.55);
    // G tunnel vision
    const gT = smoothstep(7.5, 11.5, w.ac.g);
    edge('4,6,14', gT * 0.6);
    // low hull heartbeat
    if (w.hull < 30 && w.playerAlive) edge('255,30,20', (0.12 + 0.1 * Math.sin(this.t * 6)) * (1 - w.hull / 30));
    if (!w.playerAlive) { g.fillStyle = 'rgba(20,0,0,0.25)'; g.fillRect(0, 0, W, H); }
  }

  // ---- conformal flight symbology --------------------------------------------------------------------------------

  private ladder(w: World, view: GameView): void {
    const g = this.ctx, ac = w.ac;
    const hdg = headingAngle(ac), pit = pitchAngle(ac);
    const cam = view.camera.position;
    const at = (hd: number, p: number, out: Vector3): Vector3 =>
      out.set(Math.sin(hd) * Math.cos(p), Math.sin(p), -Math.cos(hd) * Math.cos(p)).multiplyScalar(4000).add(cam);
    const a = { x: 0, y: 0, behind: false }, b = { x: 0, y: 0, behind: false };
    const seg = (hd1: number, hd2: number, p: number, color: string, width: number, dashed = false) => {
      view.project(at(hd1, p, _v), a);
      view.project(at(hd2, p, _w), b);
      if (a.behind || b.behind) return false;
      if (dashed) g.setLineDash([6 * this.u, 5 * this.u]);
      this.line(a.x, a.y, b.x, b.y, color, width);
      if (dashed) g.setLineDash([]);
      return true;
    };
    g.save();
    // horizon
    const hw = 0.32;
    seg(hdg - hw, hdg - 0.07, 0, CY_DIM, 1.6);
    seg(hdg + 0.07, hdg + hw, 0, CY_DIM, 1.6);
    for (let p = -60; p <= 60; p += 10) {
      if (p === 0 || Math.abs(p - pit / DEG) > 24) continue;
      const pr = p * DEG;
      const d = 0.075 / Math.max(Math.cos(pr), 0.35);
      const col = p > 0 ? CY_DIM : 'rgba(111,243,255,0.3)';
      const neg = p < 0;
      seg(hdg - d, hdg - d * 0.38, pr, col, 1.3, neg);
      seg(hdg + d * 0.38, hdg + d, pr, col, 1.3, neg);
      const label = p < 0 ? `−${-p}` : String(p);
      view.project(at(hdg - d * 1.12, pr, _v), a);
      if (!a.behind) this.num(label, a.x, a.y, 12, CY_DIM, 'right');
      view.project(at(hdg + d * 1.12, pr, _w), b);
      if (!b.behind) this.num(label, b.x, b.y, 12, CY_DIM, 'left');
    }
    g.restore();
  }

  private gunsight(w: World): void {
    const ac = w.ac, g = this.ctx;
    // boresight: where the cannon points
    forwardOf(ac, _f);
    _v.copy(ac.pos).addScaledVector(_f, 900);
    const p = this.proj(_v);
    if (!p.behind) {
      const { x, y } = p, r = 15 * this.u;
      const hot = w.overheated;
      const col = hot ? RED : CY;
      this.circle(x, y, r, col, 1.6);
      this.circle(x, y, 1.6 * this.u, col, 1, true);
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) this.line(x + dx * r, y + dy * r, x + dx * (r + 7 * this.u), y + dy * (r + 7 * this.u), col, 1.6);
      // heat ring
      if (w.heat > 4) {
        g.beginPath(); g.arc(x, y, r + 12 * this.u, -Math.PI / 2, -Math.PI / 2 + (w.heat / 100) * Math.PI * 2);
        g.strokeStyle = w.heat > 80 ? RED : w.heat > 55 ? AMBER : CY_DIM; g.lineWidth = 2 * this.u; g.stroke();
      }
      // hit marker
      if (this.hitMark > 0) {
        const k = 9 * this.u, o = 5 * this.u;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) this.line(x + sx * o, y + sy * o, x + sx * (o + k), y + sy * (o + k), WHITE, 2.2);
      }
    }
    // flight path marker (where you are actually going)
    if (ac.speed > 20) {
      _v.copy(ac.pos).addScaledVector(_w.copy(ac.vel).normalize(), 900);
      const q = this.proj(_v);
      if (!q.behind) {
        const r = 7 * this.u, { x, y } = q;
        this.circle(x, y, r, CY, 1.6);
        this.line(x - r, y, x - r - 9 * this.u, y, CY, 1.6);
        this.line(x + r, y, x + r + 9 * this.u, y, CY, 1.6);
        this.line(x, y - r, x, y - r - 7 * this.u, CY, 1.6);
        // bank-aware: tilt hint for very steep bank
        const bank = bankAngle(ac);
        if (Math.abs(bank) > 1.2) this.text(`${Math.round(bank / DEG)}°`, x, y + 22 * this.u, 11, AMBER, 'center');
      }
    }
  }

  private mouseStick(s: HudState): void {
    const g = this.ctx, cx = this.w / 2, cy = this.h / 2;
    const R = Math.min(this.w, this.h) * 0.34;
    g.save();
    g.setLineDash([3, 6]);
    this.circle(cx, cy, R, CY_FAINT, 1);
    g.setLineDash([]);
    this.line(cx, cy, s.mouse.x, s.mouse.y, CY_FAINT, 1);
    this.circle(s.mouse.x, s.mouse.y, 6 * this.u, CY_DIM, 1.6);
    g.restore();
  }

  // ---- targets ---------------------------------------------------------------------------------------------------

  private targets(w: World, view: GameView): void {
    const ac = w.ac, g = this.ctx;
    const edge = (x: number, y: number) => {
      const cx = this.w / 2, cy = this.h / 2, dx = x - cx, dy = y - cy;
      const mx = 56 * this.u, mt = 104 * this.u, mb = 120 * this.u;
      const kx = (cx - mx) / Math.max(Math.abs(dx), 1e-3);
      const ky = ((dy < 0 ? cy - mt : this.h - mb - cy)) / Math.max(Math.abs(dy), 1e-3);
      const k = Math.min(kx, ky);
      return { x: cx + dx * k, y: cy + dy * k, ang: Math.atan2(dy, dx) };
    };
    const arrow = (x: number, y: number, ang: number, color: string, label?: string) => {
      g.save(); g.translate(x, y); g.rotate(ang);
      g.fillStyle = color; g.beginPath();
      g.moveTo(11 * this.u, 0); g.lineTo(-7 * this.u, -8 * this.u); g.lineTo(-3 * this.u, 0); g.lineTo(-7 * this.u, 8 * this.u); g.closePath(); g.fill();
      g.restore();
      if (label) this.text(label, x - Math.cos(ang) * 24 * this.u, y - Math.sin(ang) * 24 * this.u, 11, color, 'center');
    };
    for (const a of w.aliens) {
      if (!isTargetable(a) || (a.kind === 'core' && a.shielded)) continue;
      const d = a.pos.distanceTo(ac.pos);
      const sel = a === w.target;
      if (d > 7000 && !sel) continue;
      const p = this.proj(a.pos);
      const onScreen = !p.behind && p.x > 0 && p.x < this.w && p.y > 0 && p.y < this.h;
      if (!onScreen) {
        // off-screen: arrow on the edge for the selected target and anything dangerous and near
        if (sel || (d < 2600 && (a.kind === 'lancer' || a.kind === 'wisp'))) {
          let x = p.x, y = p.y;
          if (p.behind) { x = this.w - x; y = this.h - y; }
          const e = edge(x, y);
          arrow(e.x, e.y, e.ang, sel ? RED : 'rgba(255,90,74,0.7)', sel ? `${(d / 1000).toFixed(1)}` : undefined);
        }
        continue;
      }
      const spec = ALIEN_SPEC[a.kind];
      const focal = this.h / 2 / Math.tan((view.camera.fov * DEG) / 2);
      const size = clamp((spec.radius * 1.2 * focal) / Math.max(d, 60), 9 * this.u, 90 * this.u);
      if (sel) {
        const lockFrac = w.lock;
        const locked = lockFrac >= 1;
        const col = locked ? RED : AMBER;
        this.bracket(p.x, p.y, size + 7 * this.u, col, 2.2);
        if (lockFrac > 0 && !locked) {
          g.beginPath(); g.arc(p.x, p.y, size + 16 * this.u, -Math.PI / 2, -Math.PI / 2 + lockFrac * Math.PI * 2);
          g.strokeStyle = AMBER; g.lineWidth = 2.5 * this.u; g.stroke();
        }
        if (locked) { this.circle(p.x, p.y, size + 16 * this.u, RED, 2.2); this.text('LOCK', p.x, p.y - size - 30 * this.u, 13, RED, 'center'); }
        const lines = [`${spec.label}`, `${Math.round(d)} M`];
        this.text(lines[0]!, p.x, p.y + size + 20 * this.u, 12, col, 'center');
        this.text(lines[1]!, p.x, p.y + size + 34 * this.u, 12, col, 'center');
        // hit points
        this.bar(p.x - 28 * this.u, p.y + size + 44 * this.u, 56 * this.u, 4 * this.u, a.hp / a.maxHp, col);
        // cannon lead pipper
        if (d < 1700) {
          const t = d / (CANNON.speed + 100);
          _v.copy(a.pos).addScaledVector(_w.copy(a.vel).sub(ac.vel), t);
          const lp = this.proj(_v);
          if (!lp.behind) {
            this.circle(lp.x, lp.y, 9 * this.u, WHITE, 1.4);
            this.circle(lp.x, lp.y, 1.6 * this.u, WHITE, 1, true);
          }
        }
      } else {
        // un-selected hostiles: small diamonds
        const s = Math.max(5, Math.min(11, size * 0.35));
        g.beginPath(); g.moveTo(p.x, p.y - s); g.lineTo(p.x + s, p.y); g.lineTo(p.x, p.y + s); g.lineTo(p.x - s, p.y); g.closePath();
        g.strokeStyle = 'rgba(255,90,74,0.85)'; g.lineWidth = 1.5 * this.u; g.stroke();
      }
    }
    // cities that are being hit: a callout so the pilot knows where to go
    for (const c of w.cities) {
      if (!c.alive || c.hurtT > 3) continue;
      _v.set(c.site.x, c.site.level + 160, c.site.z);
      const p = this.proj(_v);
      const blink = Math.sin(this.t * 8) > -0.2;
      if (!p.behind && p.x > 0 && p.x < this.w && p.y > 0 && p.y < this.h) {
        if (blink) this.text(`${c.site.name} ▾`, p.x, p.y, 13, RED, 'center');
      } else {
        let x = p.x, y = p.y;
        if (p.behind) { x = this.w - x; y = this.h - y; }
        const e = edge(x, y);
        if (blink) arrow(e.x, e.y, e.ang, RED, c.site.name);
      }
    }
  }

  /** Warn about alien fire that will pass close to the aircraft. */
  private incoming(w: World): void {
    const ac = w.ac;
    let worst = -1, worstT = 9;
    for (let i = 0; i < w.bolts.length; i++) {
      const b = w.bolts[i]!;
      _v.copy(b.pos).sub(ac.pos);
      _w.copy(b.vel).sub(ac.vel);
      const vv = _w.lengthSq();
      if (vv < 1) continue;
      const t = -_v.dot(_w) / vv;
      if (t < 0.05 || t > 1.8) continue;
      const miss = _v.addScaledVector(_w, t).length();
      if (miss < 55 && t < worstT) { worst = i; worstT = t; }
    }
    if (worst < 0) { this.incomingAlert = 0; return; }
    this.incomingAlert = 1;
    const b = w.bolts[worst]!;
    const p = this.proj(b.pos);
    const g = this.ctx;
    const cx = this.w / 2, cy = this.h / 2;
    let x = p.x, y = p.y;
    if (p.behind) { x = this.w - x; y = this.h - y; }
    const dx = x - cx, dy = y - cy, ang = Math.atan2(dy, dx);
    const r = Math.min(this.w, this.h) * 0.36;
    const blink = Math.sin(this.t * 22) > 0;
    if (blink) {
      g.save(); g.translate(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r); g.rotate(ang);
      g.fillStyle = RED; g.beginPath();
      g.moveTo(16 * this.u, 0); g.lineTo(-6 * this.u, -13 * this.u); g.lineTo(-6 * this.u, 13 * this.u); g.closePath(); g.fill();
      g.restore();
    }
  }
  incomingAlert = 0;

  // ---- instruments -----------------------------------------------------------------------------------------------

  private tapes(w: World): void {
    const ac = w.ac, g = this.ctx, u = this.u;
    const cy = this.h / 2;
    const xl = this.w / 2 - 330 * u, xr = this.w / 2 + 330 * u;
    const half = 120 * u;
    g.save();

    // speed tape (km/h)
    const kmh = ac.speed * 3.6;
    const pxPer = 0.42 * u;
    g.beginPath(); g.rect(xl - 70 * u, cy - half, 80 * u, half * 2); g.clip();
    for (let v = Math.floor((kmh - half / pxPer) / 50) * 50; v <= kmh + half / pxPer; v += 50) {
      if (v < 0) continue;
      const y = cy - (v - kmh) * pxPer;
      const major = v % 100 === 0;
      this.line(xl + 8 * u, y, xl + (major ? -2 : 3) * u, y, major ? CY : CY_DIM, 1.4);
      if (major) this.num(String(v), xl - 8 * u, y, 13, CY_DIM, 'right');
    }
    g.restore();
    g.save();
    g.beginPath(); g.rect(xr - 10 * u, cy - half, 90 * u, half * 2); g.clip();
    const alt = ac.pos.y, pxA = 0.34 * u;
    for (let v = Math.floor((alt - half / pxA) / 50) * 50; v <= alt + half / pxA; v += 50) {
      const y = cy - (v - alt) * pxA;
      const major = v % 100 === 0;
      this.line(xr - 8 * u, y, xr + (major ? 2 : -3) * u, y, major ? CY : CY_DIM, 1.4);
      if (major) this.num(String(v), xr + 8 * u, y, 13, CY_DIM, 'left');
    }
    g.restore();

    // value boxes
    this.box(xl - 34 * u, cy, 66 * u, 24 * u);
    this.num(String(Math.round(kmh)), xl - 4 * u, cy, 19, WHITE, 'right');
    this.text('KM/H', xl - 34 * u, cy - 25 * u, 10, CY_DIM, 'left');
    this.box(xr + 34 * u, cy, 66 * u, 24 * u);
    this.num(String(Math.round(alt)), xr + 62 * u, cy, 19, WHITE, 'right');
    this.text('ALT M', xr + 4 * u, cy - 25 * u, 10, CY_DIM, 'left');

    // secondary readouts under each tape
    const gnd = ac.pos.y - surfaceHeight(ac.pos.x, ac.pos.z);
    const ry = cy + half + 16 * u;
    this.num(`R ${Math.max(0, Math.round(gnd))}`, xr + 4 * u, ry, 15, w.tti < 4 ? RED : gnd < 500 ? AMBER : CY_DIM, 'left');
    this.num(`${ac.vel.y >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(ac.vel.y))}`, xr + 4 * u, ry + 18 * u, 14, CY_DIM, 'left');
    this.num(`M ${(ac.speed / 330).toFixed(2)}`, xl - 4 * u, ry, 15, CY_DIM, 'right');
    this.num(`G ${ac.g.toFixed(1)}`, xl - 4 * u, ry + 18 * u, 15, ac.g > 9 ? RED : ac.g > 6.5 ? AMBER : CY_DIM, 'right');
    // throttle tick beside the speed tape
    const tx = xl - 66 * u, th = 150 * u;
    this.bar(tx, cy - th / 2, 5 * u, th, 0, CY);
    const fill = ac.throttle * th;
    g.fillStyle = CY; g.fillRect(tx, cy + th / 2 - fill, 5 * u, fill);
    if (ac.boosting) { g.fillStyle = AMBER; g.fillRect(tx - 4 * u, cy - th / 2, 3 * u, th); }
    this.text('THR', tx + 2.5 * u, cy + th / 2 + 12 * u, 10, CY_DIM, 'center');
  }

  private box(cx: number, cy: number, w: number, h: number): void {
    const g = this.ctx;
    g.fillStyle = 'rgba(6,16,30,0.62)';
    g.fillRect(cx - w / 2, cy - h / 2, w, h);
    g.strokeStyle = CY_DIM; g.lineWidth = 1.2; g.strokeRect(cx - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1);
  }

  private headingTape(w: World): void {
    const g = this.ctx, u = this.u;
    const hdg = headingAngle(w.ac) / DEG;
    const y = 44 * u, W = 300 * u, px = 4.2 * u;
    g.save();
    g.beginPath(); g.rect(this.w / 2 - W / 2, y - 18 * u, W, 40 * u); g.clip();
    for (let d = Math.floor((hdg - W / 2 / px) / 5) * 5; d <= hdg + W / 2 / px; d += 5) {
      const x = this.w / 2 + (d - hdg) * px;
      const dd = ((d % 360) + 360) % 360;
      const major = dd % 10 === 0;
      this.line(x, y + 8 * u, x, y + (major ? -1 : 3) * u, major ? CY : CY_DIM, 1.4);
      if (dd % 30 === 0) {
        const lab = dd === 0 ? 'N' : dd === 90 ? 'E' : dd === 180 ? 'S' : dd === 270 ? 'W' : String(dd / 10).padStart(2, '0');
        this.num(lab, x, y - 11 * u, 13, dd % 90 === 0 ? WHITE : CY_DIM, 'center');
      }
    }
    g.restore();
    g.fillStyle = CY; g.beginPath(); g.moveTo(this.w / 2, y + 12 * u); g.lineTo(this.w / 2 - 6 * u, y + 22 * u); g.lineTo(this.w / 2 + 6 * u, y + 22 * u); g.closePath(); g.fill();
    this.num(String(Math.round(((hdg % 360) + 360) % 360)).padStart(3, '0'), this.w / 2, y + 36 * u, 14, WHITE, 'center');
  }

  private compactReadout(w: World): void {
    const ac = w.ac, u = this.u;
    const x = this.w / 2;
    this.num(`${Math.round(ac.speed * 3.6)} KM/H`, x - 130 * u, this.h / 2 + 90 * u, 16, WHITE, 'right');
    this.num(`${Math.round(ac.pos.y)} M`, x + 130 * u, this.h / 2 + 90 * u, 16, WHITE, 'left');
    this.num(`${String(Math.round(((headingAngle(ac) / DEG) % 360 + 360) % 360)).padStart(3, '0')}°`, x, 28 * u, 16, WHITE, 'center');
    this.num(`THR ${Math.round(ac.throttle * 100)}%`, x - 130 * u, this.h / 2 + 112 * u, 13, CY_DIM, 'right');
  }

  private vitals(w: World): void {
    const u = this.u, cx = this.w / 2;
    const bw = (this.compact ? 130 : 200) * u, bh = 8 * u, gap = 16 * u;
    const y = this.h - (this.compact ? 30 : 46) * u;
    const x0 = cx - gap / 2 - bw, x1 = cx + gap / 2;
    this.text('SHIELD', x0, y - 12 * u, 10, CY_DIM, 'left');
    this.num(String(Math.ceil(w.shield)), x0 + bw, y - 12 * u, 13, w.shield <= 0 ? RED : CY_DIM, 'right');
    this.bar(x0, y - bh / 2, bw, bh, w.shield / 100, w.shield <= 0 ? RED : CY, undefined, 10);
    const hc = w.hull < 30 ? RED : w.hull < 60 ? AMBER : WHITE;
    this.text('HULL', x1, y - 12 * u, 10, CY_DIM, 'left');
    this.num(String(Math.ceil(w.hull)), x1 + bw, y - 12 * u, 13, w.hull < 30 ? RED : CY_DIM, 'right');
    this.bar(x1, y - bh / 2, bw, bh, w.hull / 100, hc, undefined, 10);
  }

  private weapons(w: World): void {
    const g = this.ctx, u = this.u;
    const x = this.w - 28 * u, y = this.h - (this.compact ? 62 : 108) * u;
    // missiles
    this.text('MSL', x - 118 * u, y, 11, CY_DIM, 'left');
    for (let i = 0; i < MISSILE.max; i++) {
      const px = x - 90 * u + i * 11 * u;
      g.fillStyle = i < w.missiles ? (w.lock >= 1 && i === w.missiles - 1 ? RED : CY) : 'rgba(111,243,255,0.14)';
      g.fillRect(px, y - 7 * u, 7 * u, 14 * u);
    }
    // cannon heat
    this.text('GUN', x - 118 * u, y + 22 * u, 11, w.overheated ? RED : CY_DIM, 'left');
    this.bar(x - 90 * u, y + 17 * u, 88 * u, 8 * u, w.heat / 100, w.overheated ? RED : w.heat > 70 ? AMBER : CY);
    // afterburner fuel
    this.text('AB', x - 118 * u, y + 40 * u, 11, w.ac.boosting ? AMBER : CY_DIM, 'left');
    this.bar(x - 90 * u, y + 35 * u, 88 * u, 8 * u, w.ac.boostFuel / 100, w.ac.boostFuel < 25 ? AMBER : CY);
  }

  private radar(w: World): void {
    const g = this.ctx, u = this.u, ac = w.ac;
    const R = (this.compact ? 56 : 78) * u;
    const cx = 24 * u + R, cy = this.h - 24 * u - R - (this.compact ? 0 : 6 * u);
    const range = 5600;
    g.save();
    g.fillStyle = 'rgba(5,14,28,0.58)';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = CY_DIM; g.lineWidth = 1.4 * u; g.stroke();
    g.beginPath(); g.arc(cx, cy, R * 0.5, 0, Math.PI * 2); g.strokeStyle = CY_FAINT; g.stroke();
    this.line(cx - R, cy, cx + R, cy, CY_FAINT, 1); this.line(cx, cy - R, cx, cy + R, CY_FAINT, 1);
    // arena boundary
    const hdg = headingAngle(ac);
    const sn = Math.sin(hdg), cs = Math.cos(hdg);
    // heading-up: the aircraft's forward direction points to the top of the scope
    const rot = (dx: number, dz: number) => ({ x: dx * cs + dz * sn, y: dx * sn - dz * cs });
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    {
      const o = rot(-ac.pos.x, -ac.pos.z);
      g.beginPath(); g.arc(cx + (o.x / range) * R, cy - (o.y / range) * R, (ARENA_RADIUS / range) * R, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,192,77,0.35)'; g.setLineDash([4 * u, 5 * u]); g.lineWidth = 1.2 * u; g.stroke(); g.setLineDash([]);
    }
    // cities
    for (const c of w.cities) {
      const o = rot(c.site.x - ac.pos.x, c.site.z - ac.pos.z);
      const k = Math.hypot(o.x, o.y) / range;
      const s = k > 0.94 ? 0.94 / k : 1;
      const x = cx + (o.x / range) * R * s, y = cy - (o.y / range) * R * s;
      const hot = c.alive && c.hurtT < 3 && Math.sin(this.t * 9) > 0;
      g.fillStyle = !c.alive ? 'rgba(120,120,130,0.6)' : hot ? RED : CY;
      g.fillRect(x - 3.5 * u, y - 3.5 * u, 7 * u, 7 * u);
      if (c.alive && c.hp < c.maxHp) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x - 5 * u, y + 5 * u, 10 * u, 2 * u); g.fillStyle = CY; g.fillRect(x - 5 * u, y + 5 * u, 10 * u * (c.hp / c.maxHp), 2 * u); }
    }
    // aliens
    for (const a of w.aliens) {
      if (a.dying > 0 || a.kind === 'mothership') continue;
      const o = rot(a.pos.x - ac.pos.x, a.pos.z - ac.pos.z);
      const k = Math.hypot(o.x, o.y) / range;
      const s = k > 0.97 ? 0.97 / k : 1;
      const x = cx + (o.x / range) * R * s, y = cy - (o.y / range) * R * s;
      const above = a.pos.y - ac.pos.y > -250;
      const sel = a === w.target;
      const r = (a.kind === 'harvester' || a.kind === 'core' ? 4.6 : a.kind === 'pod' ? 3.6 : a.kind === 'lancer' ? 3.8 : 2.8) * u;
      g.fillStyle = g.strokeStyle = sel ? AMBER : RED;
      g.lineWidth = 1.4 * u;
      g.beginPath();
      if (a.kind === 'lancer') { g.moveTo(x, y - r - 1); g.lineTo(x + r, y + r); g.lineTo(x - r, y + r); g.closePath(); }
      else g.arc(x, y, r, 0, Math.PI * 2);
      if (above) g.fill(); else g.stroke();
      if (sel) { g.beginPath(); g.arc(x, y, r + 3 * u, 0, Math.PI * 2); g.stroke(); }
    }
    // boss
    const boss = w.aliens.find((a) => a.kind === 'mothership');
    if (boss) {
      const o = rot(boss.pos.x - ac.pos.x, boss.pos.z - ac.pos.z);
      g.strokeStyle = LIME; g.lineWidth = 2 * u; g.beginPath();
      g.arc(cx + (o.x / range) * R, cy - (o.y / range) * R, (400 / range) * R + 2, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
    // ownship and view cone
    g.fillStyle = CY;
    g.beginPath(); g.moveTo(cx, cy - 6 * u); g.lineTo(cx + 4.5 * u, cy + 5 * u); g.lineTo(cx, cy + 3 * u); g.lineTo(cx - 4.5 * u, cy + 5 * u); g.closePath(); g.fill();
    this.line(cx, cy, cx - Math.sin(35 * DEG) * R, cy - Math.cos(35 * DEG) * R, CY_FAINT, 1);
    this.line(cx, cy, cx + Math.sin(35 * DEG) * R, cy - Math.cos(35 * DEG) * R, CY_FAINT, 1);
    this.text(`${(range / 1000).toFixed(1)} KM`, cx + R - 2 * u, cy + R + 10 * u, 10, CY_DIM, 'right');
  }

  private topBar(w: World, dt: number): void {
    const u = this.u;
    // cities, left
    let x = 24 * u, y = 26 * u;
    this.text('CITIES', x, y, 11, CY_DIM);
    y += 16 * u;
    for (const c of w.cities) {
      const hot = c.alive && c.hurtT < 3;
      const col = !c.alive ? 'rgba(130,130,140,0.8)' : hot && Math.sin(this.t * 9) > 0 ? RED : c.hp / c.maxHp < 0.4 ? AMBER : CY;
      this.text(c.site.name, x, y, 12, col, 'left');
      this.bar(x + 66 * u, y - 4 * u, 78 * u, 8 * u, c.alive ? c.hp / c.maxHp : 0, col);
      y += 17 * u;
    }
    // wave / score, right
    const rx = this.w - 24 * u;
    const inWave = w.wave > 0;
    const wtxt = !inWave ? 'INCOMING' : w.waveState === 'clear' ? `WAVE ${w.wave} CLEAR` : `WAVE ${w.wave} / ${WAVES.length}`;
    this.text(wtxt, rx, 26 * u, 12, CY_DIM, 'right');
    if (w.score !== this.lastScore) { this.scoreBump = 1; this.lastScore = w.score; }
    this.scoreBump = Math.max(0, this.scoreBump - dt * 4);
    this.num(String(w.score).padStart(7, '0'), rx, 50 * u, 26 + this.scoreBump * 4, this.scoreBump > 0.05 ? WHITE : CY, 'right');
    // the multiplier the NEXT kill will earn
    if (w.combo > 0) this.text(`COMBO x${(1 + Math.min(w.combo, 10) * 0.1).toFixed(1)}`, rx, 74 * u, 12, AMBER, 'right');
    const left = w.hostiles;
    if (w.waveState === 'active') this.text(`${left} HOSTILE${left === 1 ? '' : 'S'}`, rx, (w.combo > 0 ? 92 : 74) * u, 12, left > 0 ? RED : CY_DIM, 'right');
    else if (w.waveState === 'clear') this.text(`NEXT WAVE ${Math.max(0, Math.ceil(w.waveT))}`, rx, 74 * u, 12, CY, 'right');
  }

  private bossBar(w: World): void {
    const b = w.bossHealth();
    if (!b) return;
    const u = this.u, cx = this.w / 2, y = (this.compact ? 56 : 98) * u, W = 300 * u;
    this.text('LEVIATHAN', cx, y - 12 * u, 12, LIME, 'center');
    // three nodes and the core
    const nodeW = 62 * u, gap = 8 * u;
    const total = 3 * nodeW + 2 * gap;
    for (let i = 0; i < 3; i++) {
      const f = b.nodes[i] ?? 0;
      this.bar(cx - total / 2 + i * (nodeW + gap), y, nodeW, 7 * u, f, f > 0 ? LIME : 'rgba(100,100,100,0.5)');
    }
    this.bar(cx - W / 2, y + 12 * u, W, 8 * u, b.core, b.coreExposed ? RED : 'rgba(80,160,255,0.7)');
    this.text(b.coreExposed ? 'CORE EXPOSED' : 'CORE SHIELDED — DESTROY THE NODES', cx, y + 32 * u, 10, b.coreExposed ? RED : CY_DIM, 'center');
  }

  private warnings(w: World): void {
    const ac = w.ac, u = this.u;
    const list: { t: string; c: string; big?: boolean }[] = [];
    const blink = Math.sin(this.t * 14) > 0;
    if (w.tti < 3.2 && ac.speed > 60) list.push({ t: 'PULL UP', c: RED, big: true });
    if (this.incomingAlert) list.push({ t: 'WARNING — INCOMING FIRE', c: RED });
    if (w.oobT > 0) list.push({ t: `LEAVING COMBAT AREA — TURN BACK  ${Math.max(0, Math.ceil(12 - w.oobT))}`, c: AMBER });
    if (ac.stalled && ac.speed < 90) list.push({ t: 'STALL', c: AMBER });
    if (w.overheated) list.push({ t: 'CANNON OVERHEAT', c: AMBER });
    if (w.hull < 30) list.push({ t: 'HULL CRITICAL', c: RED });
    if (ac.g > 9.5) list.push({ t: 'OVER-G', c: AMBER });
    let y = this.h / 2 - (this.compact ? 70 : 96) * u;
    for (const l of list.slice(0, 3)) {
      if (!blink && l.big) { y += 40 * u; continue; }
      this.text(l.t, this.w / 2, y, l.big ? 34 : 15, l.c, 'center', 700);
      y += (l.big ? 40 : 22) * u;
    }
  }

  private messages(dt: number): void {
    const u = this.u;
    let y = this.h - (this.compact ? 62 : 86) * u;
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i]!;
      m.age += dt;
      const a = m.age < 0.3 ? m.age / 0.3 : m.age > 6 ? Math.max(0, 1 - (m.age - 6) / 1.2) : 1;
      if (a <= 0) { this.msgs.splice(i, 1); continue; }
      const col = m.tone === 'bad' ? RED : m.tone === 'warn' ? AMBER : m.tone === 'good' ? LIME : CY;
      this.ctx.globalAlpha = a;
      this.text(`▸ ${m.text}`, this.w / 2, y, 13, col, 'center');
      this.ctx.globalAlpha = 1;
      y -= 19 * u;
    }
  }

  private popupsDraw(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.age += dt;
      if (p.age > 1.4) { this.popups.splice(i, 1); continue; }
      const s = this.proj(p.pos);
      if (s.behind) continue;
      this.ctx.globalAlpha = 1 - p.age / 1.4;
      this.num(p.text, s.x, s.y - 20 * this.u - p.age * 34 * this.u, 20, p.color, 'center');
      this.ctx.globalAlpha = 1;
    }
  }

  private bannerDraw(dt: number): void {
    const b = this.banner;
    if (!b) return;
    b.age += dt;
    const u = this.u, hold = 2.6;
    if (!b.sticky && b.age > hold + 1) { this.banner = null; return; }
    const t = b.age;
    const a = b.sticky ? Math.min(1, t / 0.5) : t < 0.35 ? t / 0.35 : t > hold ? 1 - (t - hold) : 1;
    const cx = this.w / 2, cy = this.h * 0.26;
    this.ctx.globalAlpha = a;
    const grow = 1 + (1 - Math.min(1, t / 0.35)) * 0.15;
    this.text(b.text, cx, cy, 44 * grow, WHITE, 'center', 700);
    this.line(cx - 130 * u, cy + 30 * u, cx + 130 * u, cy + 30 * u, CY_DIM, 1.5);
    this.text(b.sub, cx, cy + 50 * u, 15, CY, 'center');
    this.ctx.globalAlpha = 1;
  }

  private hintsDraw(s: HudState): void {
    if (s.missionTime > 16 || s.missionTime < 0.5) return;
    const a = s.missionTime < 14 ? 1 : 1 - (s.missionTime - 14) / 2;
    const u = this.u;
    this.ctx.globalAlpha = a * 0.9;
    const lines = s.touch
      ? ['Left stick: pitch and roll  ·  FIRE / MSL / BOOST on the right']
      : ['W S pitch   A D roll   Q E yaw   R F throttle   Shift afterburner',
         'Space cannon   Enter missile   T target   C camera   H assist   Esc pause'];
    let y = (this.compact ? 70 : 128) * u;
    for (const l of lines) { this.text(l, this.w / 2, y, 13, CY_DIM, 'center'); y += 20 * u; }
    this.ctx.globalAlpha = 1;
  }

  /** The demo reel's label and the way out. */
  private demoChip(d: { title: string; caption: string }): void {
    const u = this.u, g = this.ctx;
    // top-left, under the city bars, clear of the heading tape, wave banner and boss bar
    const x = 24 * u, y = (this.compact ? 92 : 132) * u;
    g.font = `600 ${Math.round(13 * u)}px "Chakra Petch", system-ui, sans-serif`;
    const label = `DEMO · ${d.title.toUpperCase()}`;
    g.font = `500 ${Math.round(12 * u)}px "Chakra Petch", system-ui, sans-serif`;
    const w = Math.min(Math.max(g.measureText(label).width, g.measureText(d.caption).width) + 28 * u, this.w * 0.3);
    g.fillStyle = 'rgba(6,16,30,0.62)';
    g.fillRect(x, y - 16 * u, w, 40 * u);
    g.strokeStyle = CY_DIM; g.lineWidth = 1.2; g.strokeRect(x + 0.5, y - 16 * u + 0.5, w - 1, 40 * u - 1);
    this.text(label, x + 12 * u, y - 2 * u, 13, CY, 'left', 700);
    this.text(d.caption, x + 12 * u, y + 14 * u, 11, CY_DIM, 'left');
    const blink = 0.55 + 0.45 * Math.sin(this.t * 3.2);
    g.globalAlpha = blink;
    this.text(this.compact ? 'TAP TO FLY' : 'PRESS ANY KEY TO FLY', this.w / 2, this.h - 12 * u, 11, WHITE, 'center');
    g.globalAlpha = 1;
  }

  private statusChips(s: HudState): void {
    const chips = [s.assist ? 'ASSIST' : 'MANUAL', s.cockpit ? 'COCKPIT' : 'CHASE'];
    this.text(chips.join('  ·  '), this.w / 2, this.h - 12 * this.u, 10, CY_FAINT, 'center');
  }

  /** Lock-on state for audio: 0 none, 1 acquiring, 2 locked. */
  lockState(w: World): 0 | 1 | 2 {
    if (!w.target) return 0;
    if (w.lock >= 1) return 2;
    return w.lock > 0.02 ? 1 : 0;
  }
}

