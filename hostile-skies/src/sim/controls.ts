// What the pilot is asking for this frame. The input layer (keyboard, mouse, pad, touch) fills one of these;
// the sim never knows which device it came from.

export interface Controls {
  /** -1..1, +1 = nose up (pitch inversion is already applied by the input layer). */
  pitch: number;
  /** -1..1, +1 = roll right. */
  roll: number;
  /** -1..1, +1 = yaw right. */
  yaw: number;
  /** -1..1 throttle lever speed (units of full travel per 2 s). */
  throttleDelta: number;
  /** Absolute throttle 0..1 (touch/pad sliders); null leaves the lever where it is. */
  throttleSet: number | null;
  boost: boolean;
  brake: boolean;
  fire: boolean;
  missile: boolean;
  cycleTarget: boolean;
}

export const newControls = (): Controls => ({
  pitch: 0, roll: 0, yaw: 0, throttleDelta: 0, throttleSet: null,
  boost: false, brake: false, fire: false, missile: false, cycleTarget: false,
});
