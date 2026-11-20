import * as THREE from 'three';
import { newBody, stepBody, type Body } from '../shared/collision';
import { INTERACT_RANGE, INTERP_DELAY, SIM_DT } from '../shared/consts';
import { insideCab, LIFT, liftNearest, LM, newLiftState, syncLiftSolids, type LiftState } from '../shared/lift';
import { buildMaple, APT, type Interactable, type MapDef } from '../shared/map';
import { angleDiff, damp, wrapAngle } from '../shared/math';
import { cleanName, FL, type InputCmd, type Look, type LiftWire, type PlayerInfo, type PlayerWire, type S2C } from '../shared/protocol';
import { clockText, hourAt, phaseName } from '../shared/daycycle';
import { ITEM_BY_ID } from '../shared/game/items';
import { DEVICE_DEFS, canPlaceDevice, type DeviceKind } from '../shared/game/rules';
import type { GameDto } from '../shared/game/types';
import { Ambient } from './ambient';
import { Avatar } from './avatar';
import { Sound, type Surface } from './audio';
import { CameraRig } from './camera';
import { buildDeviceMesh, HouseVisuals, tintGhost } from './devices3d';
import { GameUI } from './gameui';
import { DEFAULT_SETTINGS, Input, type Settings } from './input';
import { Net, type NetLike } from './net';
import { Rig } from './rig';
import { UI } from './ui';
import { World3D } from './world3d';

export interface Profile { token: string; name: string; look: Look }
interface Snap { t: number; x: number; y: number; z: number; r: number; s: number; f: number; k: number }
interface Remote { id: string; name: string; look: Look; avatar: Avatar; buf: Snap[]; seat: number; pos: THREE.Vector3 }
interface Pending { seq: number; mx: number; mz: number; jump: boolean; sprint: boolean; crouch: boolean }

export class Game {
  readonly map: MapDef = buildMaple();
  rig: Rig; world3d: World3D; cam: CameraRig; input: Input; net: NetLike; sound = new Sound(); ui: UI;
  settings: Settings;
  state: 'menu' | 'connecting' | 'play' = 'menu';
  profile: Profile;

  // me
  myId = ''; myName = ''; myLook!: Look;
  body: Body = newBody();
  myAvatar: Avatar;
  private pending: Pending[] = [];
  private outbox: InputCmd[] = [];
  private seq = 0;
  seat = -1;
  private err = new THREE.Vector3();
  private visY = 0;
  private myEmote = 0;
  private lastSend = 0;
  private acc = 0;
  private standCooldown = 0;

  // world mirror
  lift: LiftState = newLiftState(this.map.lift);
  private liftStamp = 0;
  private liftWire: LiftWire = { y: 0.2, v: 0, d: 1, m: 0, tg: 0 };
  private doorsOpen = new Set<number>();
  private found = new Set<number>();
  private remotes = new Map<string, Remote>();
  private offset = 0; private haveOffset = false;
  private target: Interactable | null = null;
  private suppressPause = false;
  private cabFloorSolid: number;
  private zoneName = '';
  private zoneTimer = 0;
  private mmTimer = 0;
  private previewAvatar: Avatar;
  private menuT = 0;
  private last = performance.now();
  private fpsFrames = 0; private fpsTime = 0; private lowFps = 0;
  private tmpV = new THREE.Vector3();
  private ambient: Ambient;
  private gameUI!: GameUI;
  private houseVis!: HouseVisuals;
  gs: GameDto | null = null;
  private viewSig = '';
  private dynTargets: Interactable[] = [];
  private placing: { kind: DeviceKind; yaw: number } | null = null;
  private ghost: THREE.Object3D | null = null;
  private ghostOk: boolean | null = null;
  private ghostPos = { x: 0, z: 0, ok: false };
  private crouching = false;
  private alarmT = 0;
  private roadRects: { x0: number; z0: number; x1: number; z1: number }[];
  private hour = 18.2;

  constructor(canvas: HTMLCanvasElement, profile: Profile, settings: Settings, private saveSettings: (s: Settings) => void, private saveProfile: (p: Profile) => void, opts: { net?: NetLike; note?: string } = {}) {
    this.net = opts.net ?? new Net();
    this.profile = profile; this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rig = new Rig(canvas);
    this.world3d = new World3D(this.map);
    this.rig.scene.add(this.world3d.root);
    this.ambient = new Ambient(this.map);
    this.rig.scene.add(this.ambient.group);
    this.roadRects = this.map.mapRects.filter((r) => r.kind === 'road');
    this.cam = new CameraRig(this.rig.camera, this.map.world);
    this.cam.isHidden = (g) => this.world3d.isHidden(g);
    this.cam.dist = this.settings.zoom;
    this.input = new Input(canvas);
    this.ui = new UI(this.map);
    this.houseVis = new HouseVisuals(this.map);
    this.rig.scene.add(this.houseVis.root);
    this.gameUI = new GameUI(this.ui.root, this.map, {
      act: (a, extra) => this.net.send({ t: 'act', a, ...(extra ?? {}) }),
      onPanel: (open) => { if (open) { this.suppressPause = true; this.input.unlock(); this.input.enabled = false; } else { this.input.enabled = true; this.input.lock(); } },
      startPlacement: (k) => this.startPlacement(k),
      toast: (kind, text) => { this.ui.toast(text, '', '', kind === 'bad' ? 4200 : 3200); if (kind === 'ok' && /\$/.test(text)) this.sound.cash(); else if (kind === 'bad') this.sound.toast(); },
    });
    this.cabFloorSolid = this.map.lift.cab[0].solid;
    syncLiftSolids(this.map.lift, this.map.world, this.lift);

    this.myAvatar = new Avatar(profile.look, profile.name);
    this.myAvatar.root.visible = false;
    this.rig.scene.add(this.myAvatar.root);
    this.previewAvatar = new Avatar(profile.look, profile.name);
    this.rig.scene.add(this.previewAvatar.root);
    this.applySettings();
    this.world3d.setSwitches([]); this.world3d.setFound(this.found);

    this.ui.onEnter = (name, look) => void this.join(name, look);
    this.ui.onLookChange = (look) => { this.previewAvatar.setLook(look); };
    this.ui.onChatSend = (text) => this.net.send({ t: 'chat', text });
    this.ui.onChatClose = () => { this.input.enabled = this.state === 'play'; this.input.lock(); };
    this.input.onInteract = () => this.interact();
    this.input.onKey = (code) => this.onKey(code);
    this.input.onLockChange = (locked) => {
      if (this.state === 'play' && !locked && !this.suppressPause && !this.ui.liftOpen && !this.ui.chatOpen && !this.ui.pauseOpen) this.openPause();
      this.suppressPause = false;
    };
    this.net.onMessage = (m) => this.onMessage(m);
    this.net.onClose = () => { if (this.state === 'play') this.returnToMenu('Connection to the neighborhood was lost.'); };
    this.ui.showMenu(profile.name, profile.look);
    if (opts.note) this.ui.setStatus(opts.note);
    this.rig.setViewShift(window.innerWidth > 720 ? 0.17 : 0);
    window.addEventListener('resize', () => this.rig.setViewShift(this.state !== 'play' && window.innerWidth > 720 ? 0.17 : 0));
    requestAnimationFrame(() => this.frame());
  }

  private applySettings() {
    this.sound.setVolume(this.settings.volume); this.sound.setMuted(this.settings.muted);
    this.cam.dist = this.settings.zoom;
    this.rig.setQuality(this.settings.quality === 'high', this.settings.quality === 'high' ? 2 : 1);
    this.saveSettings(this.settings);
  }

  // ───────────────────────── session ─────────────────────────
  private async join(rawName: string, look: Look) {
    if (this.state !== 'menu') return;
    this.sound.start(); this.sound.ui();
    const name = cleanName(rawName);
    this.profile = { ...this.profile, name, look: { ...look } };
    this.saveProfile(this.profile);
    this.state = 'connecting'; this.ui.setConnecting(true); this.ui.setStatus('Walking over…');
    this.input.lock();
    try {
      await this.net.connect();
    } catch (e) {
      this.state = 'menu'; this.ui.setConnecting(false); this.ui.setStatus((e as Error).message || 'Could not connect', true);
      return;
    }
    this.net.send({ t: 'hello', token: this.profile.token, name, look });
  }

  private returnToMenu(msg: string) {
    this.state = 'menu';
    this.input.unlock(); this.input.enabled = true;
    this.ui.hidePause(); this.ui.hideLift();
    for (const r of this.remotes.values()) { this.rig.scene.remove(r.avatar.root); r.avatar.dispose(); }
    this.remotes.clear();
    this.myAvatar.root.visible = false; this.previewAvatar.root.visible = true;
    this.ui.showMenu(this.profile.name, this.profile.look); this.ui.setStatus(msg, true);
    this.rig.setViewShift(window.innerWidth > 720 ? 0.17 : 0);
    this.world3d.setHiddenGroups(new Set());
  }

  private onWelcome(m: Extract<S2C, { t: 'welcome' }>) {
    this.myId = m.id; this.myName = m.name; this.myLook = m.look;
    this.myAvatar.dispose(); this.rig.scene.remove(this.myAvatar.root);
    this.myAvatar = new Avatar(m.look, m.name);
    this.rig.scene.add(this.myAvatar.root);
    this.copyBody(m.you);
    this.pending.length = 0; this.outbox.length = 0; this.err.set(0, 0, 0); this.seat = m.seat;
    this.visY = this.body.y; this.seq = 0;
    this.doorsOpen = new Set(m.doors); this.applyWorld(m.doors, m.sw);
    this.found = new Set(m.found); this.world3d.setFound(this.found);
    this.setLift(m.lift);
    this.offset = m.st - performance.now(); this.haveOffset = true;
    for (const r of this.remotes.values()) { this.rig.scene.remove(r.avatar.root); r.avatar.dispose(); }
    this.remotes.clear();
    for (const p of m.players) this.addRemote(p);
    this.cam.yaw = this.body.yaw; this.cam.pitch = 0.3;
    this.cam.update(0.016, this.focusPoint(), false, true);
    this.previewAvatar.root.visible = false; this.myAvatar.root.visible = true;
    this.state = 'play';
    this.ui.hideMenu(); this.ui.showHud(m.name, m.look); this.ui.setPlace('Block 01 · Maple Street');
    this.ui.setStars(this.found.size, this.map.found.length);
    this.refreshOnline();
    this.rig.setViewShift(0);
    this.input.enabled = true;
    this.ui.toast(`Welcome to Maple Street, ${m.name}.`, '', '', 3500);
    this.ui.setStatus('');
  }

  // ───────────────────────── messages ─────────────────────────
  private onMessage(m: S2C) {
    switch (m.t) {
      case 'welcome': return this.onWelcome(m);
      case 'snap': return this.onSnap(m);
      case 'join': this.addRemote(m.p); this.refreshOnline(); this.ui.toast(`${m.p.name} joined the street`, '', '', 2400); return;
      case 'leave': {
        const r = this.remotes.get(m.id);
        if (r) { this.rig.scene.remove(r.avatar.root); r.avatar.dispose(); this.remotes.delete(m.id); this.refreshOnline(); this.ui.toast(`${r.name} left`, '', '', 2000); }
        return;
      }
      case 'world': this.doorsOpen = new Set(m.doors); this.applyWorld(m.doors, m.sw); return;
      case 'evt': return this.onEvent(m);
      case 'game': return this.onGame(m.g);
      case 'chat': {
        this.ui.chatLine(m.name, m.text);
        if (m.id === this.myId) this.myAvatar.say(m.text); else this.remotes.get(m.id)?.avatar.say(m.text);
        return;
      }
      case 'toast': this.ui.toast(m.text); this.sound.toast(); return;
      case 'found': {
        this.found.add(m.id); this.world3d.setFound(this.found);
        this.ui.toast(`Secret found: ${m.name}`, 'found', `${m.text}  ·  ${m.count}/${m.total}`, 6000);
        this.ui.setStars(m.count, m.total); this.sound.found();
        return;
      }
      case 'pong': this.net.rtt = performance.now() - m.c; return;
      case 'error': this.ui.setStatus(m.text, true); this.state = 'menu'; this.ui.setConnecting(false); this.net.close(); return;
    }
  }

  private applyWorld(doors: number[], sw: number[]) {
    this.world3d.setDoors(doors);
    const open = new Set(doors);
    for (const d of this.map.doors) this.map.world.solids[d.solid].enabled = !open.has(d.id);
    this.world3d.setSwitches(sw);
  }

  private onEvent(m: Extract<S2C, { t: 'evt' }>) {
    const d = Math.hypot(m.x - this.body.x, m.z - this.body.z, (m.y - this.body.y) * 0.6);
    switch (m.k) {
      case 'ding': this.sound.ding(d); break;
      case 'door': this.sound.door(d, !!m.o); break;
      case 'knock': this.sound.knock(d); break;
      case 'bell': this.sound.bell(d); break;
      case 'click': this.sound.click(d); break;
      case 'alarm': this.houseVis.setAlarm(!!m.o, m.x, m.y, m.z); if (m.o) this.ui.toast('An alarm is ringing on the street.', '', '', 3000); break;
      case 'cash': this.sound.cash(); break;
      case 'pick': this.sound.pick(d); break;
      case 'arrest': this.sound.arrest(); break;
      case 'dog': if (m.o === 9) this.sound.whistle(d); else this.sound.bark(d); break;
      default: break;
    }
  }

  private addRemote(p: PlayerInfo) {
    if (p.id === this.myId || this.remotes.has(p.id)) return;
    const avatar = new Avatar(p.look, p.name);
    this.rig.scene.add(avatar.root);
    this.remotes.set(p.id, { id: p.id, name: p.name, look: p.look, avatar, buf: [], seat: -1, pos: new THREE.Vector3() });
  }
  private refreshOnline() {
    this.ui.setOnline([{ id: this.myId, name: this.myName, me: true }, ...[...this.remotes.values()].map((r) => ({ id: r.id, name: r.name }))]);
  }

  private setLift(w: LiftWire) {
    this.liftWire = w; this.liftStamp = performance.now();
    this.lift.y = w.y; this.lift.v = w.v; this.lift.door = w.d; this.lift.mode = w.m; this.lift.target = w.tg;
  }
  /** Lift pose extrapolated to "now" so the cab and the predicted rider stay glued together. */
  private liftNow(): LiftState {
    const def = this.map.lift, w = this.liftWire;
    const dt = Math.min(0.25, (performance.now() - this.liftStamp) / 1000);
    let y = w.y, door = w.d;
    if (w.m === LM.MOVING) {
      y += w.v * dt;
      const ty = def.floors[w.tg];
      y = w.v > 0 ? Math.min(y, ty) : w.v < 0 ? Math.max(y, ty) : y;
    } else if (w.m === LM.CLOSING) door = Math.max(0, door - dt / LIFT.doorT);
    else if (w.m === LM.OPENING) door = Math.min(1, door + dt / LIFT.doorT);
    return { y, v: w.v, door, mode: w.m, target: w.tg, queue: [] };
  }

  private onSnap(m: Extract<S2C, { t: 'snap' }>) {
    const sample = m.st - performance.now();
    this.offset = this.haveOffset ? this.offset + (sample - this.offset) * 0.05 : sample; this.haveOffset = true;
    this.setLift(m.l);
    syncLiftSolids(this.map.lift, this.map.world, this.liftNow());

    if (m.seat !== this.seat) { this.seat = m.seat; this.pending.length = 0; this.err.set(0, 0, 0); this.copyBody(m.you); this.visY = this.body.y; }
    else if (this.seat >= 0) { this.copyBody(m.you); }
    else {
      const ox = this.body.x, oy = this.body.y, oz = this.body.z;
      this.copyBody(m.you);
      this.pending = this.pending.filter((p) => p.seq > m.ack);
      for (const p of this.pending) stepBody(this.map.world, this.body, { mx: p.mx, mz: p.mz, jump: p.jump, sprint: p.sprint, crouch: p.crouch }, SIM_DT);
      const dx = ox - this.body.x, dy = oy - this.body.y, dz = oz - this.body.z;
      if (Math.hypot(dx, dy, dz) > 2.5) { this.err.set(0, 0, 0); this.visY = this.body.y; }
      else this.err.set(this.err.x + dx, this.err.y + dy, this.err.z + dz);
    }
    for (const p of m.p) this.pushRemote(p, m.st);
  }
  private copyBody(w: { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; g: number; c: number }) {
    const b = this.body;
    b.x = w.x; b.y = w.y; b.z = w.z; b.vx = w.vx; b.vy = w.vy; b.vz = w.vz; b.yaw = w.yaw; b.grounded = !!w.g; b.coyote = w.c; b.support = -1;
  }
  private pushRemote(p: PlayerWire, st: number) {
    let r = this.remotes.get(p.i);
    if (!r) { this.addRemote({ id: p.i, name: 'Neighbor', look: this.myLook }); r = this.remotes.get(p.i); if (!r) return; }
    r.buf.push({ t: st, x: p.x, y: p.y, z: p.z, r: p.r, s: p.s, f: p.f, k: p.k });
    if (r.buf.length > 24) r.buf.shift();
    r.seat = p.k - 1;
  }

  // ───────────────────────── the game layer ─────────────────────────
  private onGame(g: GameDto) {
    this.gs = g;
    const sig = JSON.stringify(g.view);
    if (sig !== this.viewSig) { this.viewSig = sig; this.houseVis.setView(g.view); this.rebuildDyn(); }
    this.houseVis.setHomes(g.homes);
    this.houseVis.setDogAsleep(!!g.heist && g.heist.dogAsleep > 0);
    this.gameUI.update(g);
  }
  private rebuildDyn() {
    const v = this.gs?.view; this.dynTargets = [];
    if (!v) return;
    const d = this.map.houses[v.id];
    v.devices.forEach((dev) => this.dynTargets.push({ id: -1000 - dev.id, kind: 'device', x: dev.x, y: d.floorY + 1.0, z: dev.z, ref: dev.id, label: DEVICE_DEFS[dev.kind].name, group: -1 }));
  }
  private act(a: string, extra: Record<string, unknown> = {}) { this.net.send({ t: 'act', a, ...extra }); }
  private heistHere() { const h = this.gs?.heist; return h && h.job ? h : null; }

  private useSlot(t: Interactable) {
    const hid = Math.floor(t.ref / 8), k = t.ref % 8, v = this.gs?.view;
    if (!v || v.id !== hid) return;
    const it = v.slots[k], hs = this.heistHere();
    if (v.mine) { this.gameUI.openManager('display'); return; }
    if (!it) return;
    if (hs && hs.house === hid && hs.phase === 'inside') { this.act('loot', { slot: k }); return; }
    const d = ITEM_BY_ID[it.def];
    this.ui.info(d.name, `${d.desc} Worth about $${d.value.toLocaleString()}.`); this.sound.toast();
  }
  private useDevice(t: Interactable) {
    const v = this.gs?.view; const dev = v?.devices.find((x) => x.id === t.ref); if (!v || !dev) return;
    const hs = this.heistHere();
    if (v.mine) { this.gameUI.openManager('security'); return; }
    if (hs && hs.house === v.id) {
      if (dev.kind === 'decoy') { this.act('loot_decoy', { id: dev.id }); return; }
      if (dev.kind === 'safe') { const s = [5, 6].find((i) => v.slots[i]); if (s !== undefined) this.act('loot', { slot: s }); else this.ui.toast('The safe is empty.'); return; }
    }
    this.ui.info(DEVICE_DEFS[dev.kind].name, DEVICE_DEFS[dev.kind].desc);
  }

  private startPlacement(kind: DeviceKind) {
    this.cancelPlacement();
    this.placing = { kind, yaw: 0 };
    this.ghost = buildDeviceMesh(kind); this.ghostOk = null;
    this.rig.scene.add(this.ghost);
    this.gameUI.setPlacing(kind, true);
  }
  private cancelPlacement() {
    if (this.ghost) { this.rig.scene.remove(this.ghost); this.ghost = null; }
    this.placing = null; this.ghostOk = null; this.gameUI.setPlacing(null);
  }
  private updatePlacement() {
    const pl = this.placing, v = this.gs?.view; if (!pl || !this.ghost) return;
    const kind = pl.kind, def = DEVICE_DEFS[kind], me = this.gs?.me;
    const b = this.body, f = 1.5;
    const x = Math.round((b.x + Math.sin(this.cam.yaw) * f) * 20) / 20, z = Math.round((b.z + Math.cos(this.cam.yaw) * f) * 20) / 20;
    let ok = false, why = '';
    if (!v || !v.mine) why = 'Go inside your home.';
    else {
      const d = this.map.houses[v.id], hp = this.gs!.homes[v.id];
      const inside = x > d.fp.x0 + 0.45 && x < d.fp.x1 - 0.45 && z > d.fp.z0 + 0.45 && z < d.fp.z1 - 0.45;
      const cap = canPlaceDevice(v.devices, kind, hp.tier);
      let clear = true;
      if (def.mount === 'floor') for (const s of this.map.world.query(x - 0.32, z - 0.32, x + 0.32, z + 0.32, [])) if (s.maxY > d.floorY + 0.08 && s.minY < d.floorY + 0.9) { clear = false; break; }
      if (!inside) why = 'Outside your home.'; else if (!cap.ok) why = cap.reason ?? ''; else if (!clear) why = 'No room there.'; else if ((me?.cash ?? 0) < def.price) why = `You need $${def.price}.`; else { ok = true; why = `$${def.price}`; }
    }
    const yaw = this.cam.yaw + pl.yaw;
    this.ghost.position.set(x, (v ? this.map.houses[v.id].floorY : b.y) + (def.mount === 'ceiling' ? 2.55 : 0), z);
    this.ghost.rotation.set(kind === 'camera' ? 0.35 : 0, yaw, 0);
    if (this.ghostOk !== ok) { this.rig.scene.remove(this.ghost); this.ghost = buildDeviceMesh(kind); tintGhost(this.ghost, ok ? 0x6fd08c : 0xe05a4a); this.rig.scene.add(this.ghost); this.ghostOk = ok; this.ghost.position.set(x, (v ? this.map.houses[v.id].floorY : b.y) + (def.mount === 'ceiling' ? 2.55 : 0), z); this.ghost.rotation.set(kind === 'camera' ? 0.35 : 0, yaw, 0); }
    this.ghostPos = { x, z, ok };
    this.gameUI.setPlacing(kind, ok, why);
  }
  private confirmPlacement() {
    const pl = this.placing; if (!pl) return;
    if (!this.ghostPos.ok) { this.ui.toast('Cannot place it there.'); return; }
    this.act('place_device', { kind: pl.kind, x: this.ghostPos.x, z: this.ghostPos.z, yaw: this.cam.yaw + pl.yaw });
    this.cancelPlacement();
  }

  // ───────────────────────── input events ─────────────────────────
  private onKey(code: string) {
    if (this.state !== 'play') return;
    if (code === 'Escape') {
      if (this.placing) return this.cancelPlacement();
      if (this.gameUI.open) return this.gameUI.close();
      if (this.ui.liftOpen) return this.closeLift();
      if (this.ui.pauseOpen) return this.closePause();
      if (!this.ui.chatOpen) { this.openPause(); this.input.unlock(); }   // browsers that deliver Esc while locked, and synthetic events
      return;
    }
    if (this.ui.liftOpen) {
      const n = code.startsWith('Digit') ? Number(code.slice(5)) : -1;
      if (n >= 0 && n <= 3) this.pickFloor(n);
      return;
    }
    if (this.ui.pauseOpen) return;
    if (code === 'Tab') { if (this.gameUI.open) this.gameUI.close(); else if (!this.ui.chatOpen) this.gameUI.openPhone(); return; }
    if (this.gameUI.open) return;
    if (code === 'KeyJ') return this.act('use_jammer');
    if (code === 'KeyT') return this.act('use_treats');
    if (code === 'KeyX') { if (this.heistHere()) this.act('heist_abort'); return; }
    if (code === 'KeyQ' && this.placing) { this.placing.yaw -= 0.4; return; }
    if (code === 'KeyR') {
      if (this.placing) { this.placing.yaw += 0.4; return; }
      let best: Remote | null = null, bd = 22;
      for (const r of this.remotes.values()) { const d = Math.hypot(r.pos.x - this.body.x, r.pos.z - this.body.z); if (d < bd) { bd = d; best = r; } }
      if (best) this.act('report', { target: best.id }); else this.ui.toast('Nobody nearby to report.');
      return;
    }
    if (code === 'Enter') { this.suppressPause = true; this.input.unlock(); this.input.enabled = false; this.ui.openChat(); return; }
    if (code === 'Digit1' || code === 'Digit2') {
      const id = code === 'Digit1' ? 1 : 2;
      if (this.seat < 0 && this.body.grounded && Math.hypot(this.body.vx, this.body.vz) < 0.5) { this.myEmote = this.myEmote === id ? 0 : id; this.net.send({ t: 'emote', id }); }
    }
  }

  private openPause() {
    this.input.enabled = false;
    this.ui.showPause(this.settings, {
      change: (s) => { this.settings = s; this.applySettings(); },
      resume: () => this.closePause(),
      leave: () => { this.net.close(); location.reload(); },
    });
  }
  private closePause() { this.ui.hidePause(); this.input.enabled = true; this.input.lock(); }

  private openLift() {
    this.suppressPause = true; this.input.unlock(); this.input.enabled = false;
    const def = this.map.lift;
    this.ui.showLift(def.names, liftNearest(def, this.liftNow().y), (f) => this.pickFloor(f), () => this.closeLift());
  }
  private closeLift() { this.ui.hideLift(); this.input.enabled = true; this.input.lock(); }
  private pickFloor(f: number) {
    this.net.send({ t: 'lift', floor: f });
    this.sound.ui();
    this.closeLift();
  }

  private interact() {
    if (this.state !== 'play' || !this.input.enabled) return;
    if (this.placing) { this.confirmPlacement(); return; }
    if (this.seat >= 0) { this.net.send({ t: 'stand' }); return; }
    const t = this.target;
    if (!t) return;
    switch (t.kind) {
      case 'porch': this.gameUI.openHouse(t.ref); return;
      case 'market': this.gameUI.openMarket('market'); return;
      case 'fence': this.gameUI.openMarket('fence'); return;
      case 'board': this.gameUI.openBoard(); return;
      case 'slot': this.useSlot(t); return;
      case 'device': this.useDevice(t); return;
      default: break;
    }
    if (t.kind === 'info') {
      const title = t.label.replace(/^(Read|Check|Inspect|Open|Browse|Take in)( the)? /i, '');
      this.ui.info(title.charAt(0).toUpperCase() + title.slice(1), t.text ?? ''); this.sound.toast(); return;
    }
    if (t.kind === 'liftPanel') { this.openLift(); return; }
    this.net.send({ t: 'interact', id: t.id });
  }

  // ───────────────────────── frame loop ─────────────────────────
  private frame() {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fpsFrames++; this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      const fps = this.fpsFrames / this.fpsTime;
      this.ui.setFps(`${Math.round(fps)} fps · ${Math.round(this.net.rtt)} ms`);
      this.lowFps = fps < 28 ? this.lowFps + 1 : 0;
      if (this.lowFps >= 4 && this.settings.quality === 'high') { this.settings.quality = 'low'; this.applySettings(); this.ui.toast('Switched to faster graphics to keep things smooth.'); this.lowFps = 0; }
      this.fpsFrames = 0; this.fpsTime = 0;
    }
    if (this.state === 'play') this.playFrame(dt); else this.menuFrame(dt);
    this.rig.render();
  }

  private menuFrame(dt: number) {
    this.menuT += dt;
    const c = this.tmpV.set(-51.2, 1.15, 5.4);
    const a = Math.PI / 2 + Math.sin(this.menuT * 0.22) * 0.55;
    this.rig.camera.position.set(c.x + Math.sin(a) * 4.3, 1.55, c.z + Math.cos(a) * 4.3);
    this.rig.camera.lookAt(c.x, 1.15, c.z);
    const av = this.previewAvatar;
    av.root.position.set(c.x, 0.12, c.z);
    av.root.rotation.y = Math.atan2(this.rig.camera.position.x - c.x, this.rig.camera.position.z - c.z);
    av.update(dt, { speed: 0, grounded: true, seated: false, emote: 0 });
    av.setPlateAlpha(0);
    this.hour = this.hourNow(); this.rig.setTime(this.hour);
    this.world3d.update(dt, this.lift, c, false, this.rig.night);
    this.ambient.update(dt, this.rig.night, this.rig.camera.position, this.rig.renderer);
    this.houseVis.update(dt, this.rig.night);
    this.rig.update(dt, c);
    this.sound.ambient(dt, true);
  }

  /** Hour of the in-game day: the server's clock, or a fixed time chosen in the pause menu. */
  private hourNow(): number {
    const fixed = { morning: 8.5, noon: 12.6, golden: 18.4, night: 23.0 }[this.settings.time as string];
    if (fixed !== undefined) return fixed;
    return hourAt((performance.now() + (this.state === 'play' && this.haveOffset ? this.offset : 0)) / 1000);
  }

  /** What the player is standing on, for footsteps. */
  private surface(): Surface {
    const b = this.body;
    if (b.support === this.cabFloorSolid) return 'metal';
    const at = this.buildingAt(b.x, b.y, b.z);
    if (at) {
      const z = this.zoneName;
      if (/Roof/.test(z)) return 'pave';
      if (/Kitchen|Lobby/.test(z)) return 'tile';
      if (/Bedroom|corridor|Unit 1B/.test(z)) return 'carpet';
      if (/Storage/.test(z)) return 'stone';
      return 'wood';
    }
    if (b.y > 0.07) return 'pave';
    for (const r of this.roadRects) if (b.x > r.x0 && b.x < r.x1 && b.z > r.z0 && b.z < r.z1) return 'road';
    return 'grass';
  }
  private indoors() {
    const at = this.buildingAt(this.body.x, this.body.y, this.body.z);
    return !!at && !(at.b.floors.length >= 5 && at.level >= 4);
  }

  private focusPoint() { return this.tmpV.set(this.body.x + this.err.x, this.visY + 1.5, this.body.z + this.err.z); }

  private playFrame(dt: number) {
    const def = this.map.lift;
    const look = this.input.look(this.settings.sens, this.settings.invertY);
    this.cam.rotate(look.yaw, look.pitch);
    const w = this.input.takeWheel();
    if (w) { if (this.placing) this.placing.yaw += w * 0.004; else { this.cam.zoom(w); this.settings.zoom = this.cam.dist; } }

    // fixed-step prediction
    this.acc = Math.min(this.acc + dt, 0.25);
    const live = this.liftNow();
    let steps = 0;
    while (this.acc >= SIM_DT && steps++ < 8) {
      this.acc -= SIM_DT;
      syncLiftSolids(def, this.map.world, live);
      this.simStep();
    }
    syncLiftSolids(def, this.map.world, live);
    const nowMs = performance.now();
    if (nowMs - this.lastSend > 48 && this.outbox.length) { this.net.send({ t: 'in', inputs: this.outbox.splice(0, 12) }); this.lastSend = nowMs; }

    // correction smoothing and stair-step smoothing
    this.err.multiplyScalar(Math.exp(-dt * 11));
    const onCab = this.body.grounded && this.body.support === this.cabFloorSolid;
    const targetY = this.body.y + this.err.y;
    if (onCab || !this.body.grounded || Math.abs(targetY - this.visY) > 0.7) this.visY = targetY;
    else this.visY = damp(this.visY, targetY, 20, dt);

    // local avatar
    const speed = Math.hypot(this.body.vx, this.body.vz);
    const seated = this.seat >= 0;
    if (speed > 0.5 || !this.body.grounded) this.myEmote = 0;
    this.myAvatar.root.position.set(this.body.x + this.err.x, this.visY, this.body.z + this.err.z);
    this.myAvatar.root.rotation.y = this.body.yaw;
    this.myAvatar.update(dt, { speed, grounded: this.body.grounded, seated, emote: this.myEmote, crouch: this.crouching });
    this.myAvatar.setPlateAlpha(0);
    this.myAvatar.root.visible = this.cam.distance > 0.95;   // camera is practically inside the head: switch to a first-person feel
    this.sound.step(dt, speed, this.body.grounded && !seated, () => this.surface());

    this.updateCutaway();
    const inCab = insideCab(def, live, this.body.x, this.body.y, this.body.z);
    this.updateRemotes(dt, live);

    this.cam.update(dt, this.focusPoint(), this.input.keys.has('ShiftLeft') && speed > 4, false, inCab);
    this.rig.update(dt, this.tmpV.set(this.body.x, this.visY, this.body.z));
    this.hour = this.hourNow(); this.rig.setTime(this.hour);
    this.world3d.update(dt, live, this.rig.camera.position, inCab, this.rig.night);
    this.ambient.update(dt, this.rig.night, this.rig.camera.position, this.rig.renderer);

    const moving = live.mode === LM.MOVING;
    this.sound.liftHum(moving ? Math.hypot(this.body.x - def.cx, this.body.z - def.cz, (this.body.y - live.y) * 0.5) : -1, Math.abs(live.v));
    this.houseVis.update(dt, this.rig.night);
    this.updatePlacement();
    this.alarmT += dt;
    this.sound.siren(this.houseVis.ringing ? Math.hypot(this.body.x - this.houseVis.root.getObjectByName('beacon')!.position.x, this.body.z - this.houseVis.root.getObjectByName('beacon')!.position.z) : -1, this.alarmT);
    const indoors = this.indoors();
    this.sound.setIndoor(indoors);
    this.sound.ambient(dt, !indoors);

    this.updateTarget(live, inCab);
    this.zoneTimer -= dt;
    if (this.zoneTimer <= 0) { this.zoneTimer = 0.25; this.updateZone(); this.ui.setPlace(`${clockText(this.hour)} · ${phaseName(this.hour)}`); }
    this.mmTimer -= dt;
    if (this.mmTimer <= 0) {
      this.mmTimer = 1 / 15;
      const b = this.body;
      this.ui.drawMinimap({ x: b.x, z: b.z, y: b.y, yaw: b.yaw }, [...this.remotes.values()].map((r) => ({ x: r.pos.x, z: r.pos.z })), this.levelLabel());
    }
    this.ui.setClickHint(!this.input.locked && !this.ui.pauseOpen && !this.ui.liftOpen && !this.ui.chatOpen);
  }

  private simStep() {
    const mv = this.input.move(this.cam.yaw);
    if (this.seat >= 0) {
      this.standCooldown -= SIM_DT;
      if ((Math.hypot(mv.mx, mv.mz) > 0.3 || mv.jump) && this.standCooldown <= 0) { this.net.send({ t: 'stand' }); this.standCooldown = 0.5; }
      return;
    }
    this.crouching = !!mv.crouch;
    const cmd: Pending = { seq: ++this.seq, mx: mv.mx, mz: mv.mz, jump: mv.jump, sprint: mv.sprint, crouch: !!mv.crouch };
    stepBody(this.map.world, this.body, mv, SIM_DT);
    this.pending.push(cmd);
    if (this.pending.length > 120) this.pending.shift();
    const q = (v: number) => Math.round(v * 1000) / 1000;
    this.outbox.push({ s: cmd.seq, x: q(mv.mx), z: q(mv.mz), j: mv.jump ? 1 : 0, r: mv.sprint ? 1 : 0, c: mv.crouch ? 1 : 0 });
    if (this.outbox.length > 36) this.outbox.splice(0, this.outbox.length - 36);
  }

  private updateRemotes(dt: number, live: LiftState) {
    const rt = performance.now() + this.offset - INTERP_DELAY * 1000;
    const here = this.body;
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (!b.length) { r.avatar.root.visible = false; continue; }
      let a = b[0], c = b[0], k = 0;
      if (rt >= b[b.length - 1].t) { a = c = b[b.length - 1]; }
      else if (rt > b[0].t) { for (let i = 0; i < b.length - 1; i++) if (rt >= b[i].t && rt <= b[i + 1].t) { a = b[i]; c = b[i + 1]; k = (rt - a.t) / Math.max(1, c.t - a.t); break; } }
      const x = a.x + (c.x - a.x) * k, z = a.z + (c.z - a.z) * k;
      let y = a.y + (c.y - a.y) * k;
      const f = k < 0.5 ? a.f : c.f, s = (k < 0.5 ? a.s : c.s) / 10;
      if (f & FL.ON_LIFT) y = live.y;       // glue riders to the cab we are drawing
      const yaw = wrapAngle(a.r + angleDiff(a.r, c.r) * k);
      r.pos.set(x, y, z);
      r.avatar.root.visible = true;
      r.avatar.root.position.set(x, y, z); r.avatar.root.rotation.y = yaw;
      r.avatar.update(dt, { speed: s, grounded: !!(f & FL.GROUNDED), seated: !!(f & FL.SEATED), emote: (f >> FL.EMOTE_SHIFT) & FL.EMOTE_MASK, crouch: !!(f & FL.CROUCH) });
      const d = Math.hypot(x - here.x, z - here.z, (y - here.y) * 0.5);
      r.avatar.setPlateAlpha(d < 18 ? 1 : d < 34 ? 1 - (d - 18) / 16 : 0);
    }
  }

  // ───────────────────────── cut-away ─────────────────────────
  private buildingAt(x: number, y: number, z: number) {
    for (const b of this.map.buildings) {
      if (!b.levelGroups.length) continue;
      if (x > b.x0 - 0.05 && x < b.x1 + 0.05 && z > b.z0 - 0.05 && z < b.z1 + 0.05 && y > -0.5 && y < b.floors[b.floors.length - 1] + 4) {
        let level = 0;
        for (let i = 1; i < b.floors.length; i++) if (y >= b.floors[i] - 0.6) level = i;
        return { b, level };
      }
    }
    return null;
  }
  private updateCutaway() {
    const h = new Set<number>();
    const at = this.buildingAt(this.body.x, this.body.y, this.body.z);
    if (at) at.b.levelGroups.forEach((g, i) => { if (i > at.level) h.add(g); });
    this.world3d.setHiddenGroups(h);
  }

  // ───────────────────────── interaction targeting ─────────────────────────
  private updateTarget(live: LiftState, inCab: boolean) {
    if (!this.input.enabled || this.seat >= 0) {
      this.target = null;
      this.ui.setPrompt(this.seat >= 0 && this.input.enabled ? 'Move or press E to stand up' : null, window.innerWidth / 2, window.innerHeight * 0.74);
      return;
    }
    // "in front of you" is either where the character faces or where the camera looks: the avatar only turns when it walks, so a
    // player who stops beside a kiosk and swings the camera round to it must still get the prompt
    const b = this.body, fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), gx = Math.sin(this.cam.yaw), gz = Math.cos(this.cam.yaw);
    const cx = b.x, cy = b.y + 1.0, cz = b.z;
    const occupied = new Set<number>();
    for (const r of this.remotes.values()) if (r.seat >= 0) occupied.add(r.seat);
    let best: Interactable | null = null, bestScore = Infinity, bestY = 0;
    const all = this.dynTargets.length ? [...this.map.interactables, ...this.dynTargets] : this.map.interactables;
    for (const it of all) {
      if (it.kind === 'slot') { const hid = Math.floor(it.ref / 8), k = it.ref % 8, v = this.gs?.view; if (!v || v.id !== hid || (!v.slots[k] && !v.mine)) continue; }
      if (it.kind === 'found' && this.found.has(it.ref)) continue;
      if (it.kind === 'seat' && occupied.has(it.ref)) continue;
      if (it.kind === 'liftPanel' && !inCab) continue;
      if (this.world3d.isHidden(it.group)) continue;
      const ay = it.kind === 'liftPanel' ? live.y + 1.1 : it.y;
      const dx = it.x - cx, dy = ay - cy, dz = it.z - cz;
      const d = Math.hypot(dx, dy, dz);
      if (d > INTERACT_RANGE) continue;
      const h = Math.hypot(dx, dz) || 1;
      const dot = Math.max(dx * fx + dz * fz, dx * gx + dz * gz) / h;
      if (it.kind !== 'liftPanel' && dot < -0.1 && d > 0.8) continue;
      // valuables and devices outrank furniture: you must never be unable to take the ring because a sofa is nearer
      const score = d - 0.6 * Math.max(0, dot) - (it.kind === 'slot' || it.kind === 'device' ? 0.7 : 0);
      if (score < bestScore) { bestScore = score; best = it; bestY = ay; }
    }
    this.target = best;
    if (!best) { this.ui.setPrompt(null); return; }
    let label = best.label;
    switch (best.kind) {
      case 'door': {
        const dd = this.map.doors[best.ref], hp = dd.house !== undefined && dd.role !== 'inner' ? this.gs?.homes[dd.house] : undefined;
        const locked = !!hp && !this.doorsOpen.has(best.ref) && !hp.mine && !hp.open && hp.owner !== 'vacant';
        label = locked ? (this.heistHere()?.house === dd.house ? 'Pick the lock' : 'Locked door') : `${this.doorsOpen.has(best.ref) ? 'Close' : 'Open'} ${best.label.toLowerCase()}`;
        break;
      }
      case 'porch': { const hp = this.gs?.homes[best.ref]; label = !hp ? 'Look at the house' : hp.owner === 'vacant' ? `No. ${this.map.houses[best.ref].number} · for sale` : hp.mine ? 'Your home' : `No. ${this.map.houses[best.ref].number} · ${hp.ownerName}`; break; }
      case 'market': label = 'Browse the market'; break;
      case 'fence': label = 'Visit the back room'; break;
      case 'board': label = 'Read the Crime Board'; break;
      case 'slot': { const hid = Math.floor(best.ref / 8), k = best.ref % 8, v = this.gs?.view, it2 = v?.slots[k]; label = v?.mine ? 'Arrange the display' : it2 ? `${this.heistHere()?.house === hid ? 'Take' : 'Look at'} the ${ITEM_BY_ID[it2.def].name.toLowerCase()}` : 'Display'; break; }
      case 'device': { const dev = this.gs?.view?.devices.find((x) => x.id === best!.ref); label = !dev ? best.label : this.gs!.view!.mine ? `${DEVICE_DEFS[dev.kind].name} (manage)` : dev.kind === 'decoy' ? 'Take the jewellery box' : dev.kind === 'safe' && this.heistHere() ? 'Crack the safe' : DEVICE_DEFS[dev.kind].name; break; }
      case 'knock': label = 'Knock'; break;
      case 'seat': label = 'Sit down'; break;
      case 'switch': label = 'Flip the switch'; break;
      default: break;
    }
    const p = this.tmpV.set(best.x, bestY + 0.35, best.z).project(this.rig.camera);
    const sx = (p.x * 0.5 + 0.5) * window.innerWidth, sy = (-p.y * 0.5 + 0.5) * window.innerHeight;
    const onScreen = p.z < 1 && p.z > -1;
    this.ui.setPrompt(label, onScreen ? Math.min(window.innerWidth - 120, Math.max(120, sx)) : window.innerWidth / 2, onScreen ? Math.min(window.innerHeight - 140, Math.max(80, sy)) : window.innerHeight * 0.72);
  }

  private updateZone() {
    const b = this.body;
    let best: { name: string; prio: number; building?: number } | null = null;
    for (const z of this.map.zones) {
      if (b.x < z.x0 || b.x > z.x1 || b.z < z.z0 || b.z > z.z1) continue;
      if (z.y0 !== undefined && b.y < z.y0) continue;
      if (z.y1 !== undefined && b.y > z.y1) continue;
      if (!best || z.prio > best.prio) best = z;
    }
    let name = best?.name ?? 'Maple Street';
    if (best && best.building !== undefined && best.name === 'Maple Court') {
      const bd = this.map.buildings.find((x) => x.id === best!.building);
      if (bd) { let lvl = 0; for (let i = 1; i < bd.floors.length; i++) if (b.y >= bd.floors[i] - 0.6) lvl = i; name = `Maple Court · ${APT.levelNames[lvl]}`; }
    }
    if (name !== this.zoneName) { this.zoneName = name; this.ui.setZone(name); }
  }
  private levelLabel() {
    const at = this.buildingAt(this.body.x, this.body.y, this.body.z);
    if (!at) return '';
    return at.b.floors.length >= 3 ? APT.levelNames[at.level] : 'Inside';
  }

  /** Debug/test hook (enabled with ?debug). */
  expose() {
    (window as unknown as { __nb: unknown }).__nb = {
      game: this,
      state: () => ({ hour: this.hour, night: this.rig.night, x: this.body.x, y: this.body.y, z: this.body.z, yaw: this.body.yaw, grounded: this.body.grounded, seat: this.seat, lift: this.liftNow(), remotes: this.remotes.size, play: this.state, zone: this.zoneName, pending: this.pending.length, err: this.err.length(), rtt: this.net.rtt, camYaw: this.cam.yaw }),
      drive: (mx: number, mz: number, jump = false, sprint = false) => { this.input.inject = { mx, mz, jump, sprint }; },
      stop: () => { this.input.inject = null; },
      look: (yaw: number, pitch: number) => { this.cam.yaw = yaw; this.cam.pitch = pitch; },
      interact: () => this.interact(),
      target: () => this.target && { kind: this.target.kind, label: this.target.label, id: this.target.id },
      pickFloor: (f: number) => this.pickFloor(f),
      gs: () => this.gs,
      act: (a: string, extra: Record<string, unknown> = {}) => this.act(a, extra),
      gameUI: this.gameUI,
    };
  }
}
