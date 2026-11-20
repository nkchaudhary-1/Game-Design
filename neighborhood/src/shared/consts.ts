// Tunables shared by client prediction and the authoritative server. Changing any of these changes both.
export const SIM_DT = 1 / 60;          // fixed simulation step (s)
export const SNAP_EVERY = 3;           // server broadcasts a snapshot every N sim steps (=20 Hz)
export const INTERP_DELAY = 0.1;       // remote players are rendered this far in the past (s)

export const P = {
  r: 0.3,            // collision half-width (square footprint)
  h: 1.75,           // body height
  step: 0.46,        // max step-up / step-down
  walk: 3.1,
  sprint: 5.6,
  crouch: 1.5,
  accel: 38,
  decel: 46,
  airControl: 0.35,
  jumpV: 6.6,
  gravity: 22,
  maxFall: 30,
  coyote: 0.1,
  turn: 14,          // rad/s facing turn rate
} as const;

export const INTERACT_RANGE = 2.2;     // client targeting range
export const INTERACT_SERVER_RANGE = 3.4; // server validation range (lag tolerance)

export const MAX_NAME = 14;
export const MAX_CHAT = 120;
