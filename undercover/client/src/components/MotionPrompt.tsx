import { useEffect, useState } from 'react';
import { dismissMotion, onMotionState, requestMotion, type MotionState } from '../parallax.js';

/** One-time iOS prompt: motion sensors need a tap-triggered permission request. */
export function MotionPrompt() {
  const [state, setState] = useState<MotionState>('unsupported');
  useEffect(() => onMotionState(setState), []);
  if (state !== 'needs-permission') return null;
  return (
    <div className="motion-prompt" role="dialog" aria-label="Enable motion">
      <div className="copy">
        <strong>Tilt your phone for depth</strong>
        <span className="muted">The city shifts as you move. Uses the motion sensor only.</span>
      </div>
      <div className="row">
        <button className="btn small ghost" onClick={dismissMotion}>
          Not now
        </button>
        <button className="btn small primary" onClick={() => void requestMotion()}>
          Enable
        </button>
      </div>
    </div>
  );
}
