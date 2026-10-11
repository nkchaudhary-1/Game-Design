import { useEffect, useState } from 'react';
import { art } from '../art.js';
import { Art } from './ui.js';

/** Layered noir city: moonlight, skyline, three fog layers, rain, grain, vignette. */
export function Atmosphere() {
  const [paused, setPaused] = useState(document.hidden);
  const [photo, setPhoto] = useState(true);
  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  return (
    <div className={`atmosphere${paused ? ' paused' : ''}${photo ? ' photo' : ''}`} aria-hidden="true">
      {photo && <Art src={art('bg-main.jpg')} className="backdrop" onMissing={() => setPhoto(false)} />}
      <div className="moonlight" />
      <div className="fog fog-bg" />
      <div className="skyline">
        <svg viewBox="0 0 800 400" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="sky-fade" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#1a1d20" stopOpacity="0" />
              <stop offset="1" stopColor="#0b0d0f" stopOpacity="1" />
            </linearGradient>
          </defs>
          {/* far rooftops */}
          <path
            fill="#0e1012"
            d="M0 260 L0 400 L800 400 L800 250 L770 250 L770 230 L740 230 L740 262 L700 262 L700 215 L690 205 L680 215 L680 250 L640 250 L640 270 L600 270 L600 235 L570 235 L570 258 L540 258 L540 220 L530 200 L520 220 L520 265 L480 265 L480 240 L450 240 L450 255 L420 255 L420 210 L400 180 L380 210 L380 250 L350 250 L350 268 L320 268 L320 230 L290 230 L290 260 L250 260 L250 240 L215 240 L215 272 L180 272 L180 225 L160 225 L160 255 L120 255 L120 245 L90 245 L90 265 L50 265 L50 238 L30 238 L30 260 Z"
          />
          {/* mid buildings */}
          <path
            fill="#0a0c0e"
            d="M0 320 L0 400 L800 400 L800 300 L760 300 L760 285 L720 285 L720 310 L670 310 L670 280 L655 272 L640 280 L640 318 L590 318 L590 295 L560 295 L560 325 L500 325 L500 290 L470 290 L470 312 L430 312 L430 300 L395 300 L395 330 L340 330 L340 288 L310 288 L310 322 L260 322 L260 305 L230 305 L230 328 L170 328 L170 298 L140 298 L140 316 L95 316 L95 302 L60 302 L60 326 L20 326 L20 308 Z"
          />
          {/* lamps */}
          <g fill="#c5c9cc" opacity="0.35">
            <circle cx="120" cy="330" r="1.6" />
            <circle cx="415" cy="336" r="1.6" />
            <circle cx="690" cy="324" r="1.6" />
          </g>
          <g stroke="#1c1f22" strokeWidth="1.5">
            <line x1="120" y1="332" x2="120" y2="400" />
            <line x1="415" y1="338" x2="415" y2="400" />
            <line x1="690" y1="326" x2="690" y2="400" />
          </g>
          {/* ground */}
          <rect x="0" y="360" width="800" height="40" fill="#070809" />
          <rect x="0" y="200" width="800" height="200" fill="url(#sky-fade)" opacity="0.5" />
        </svg>
      </div>
      <div className="fog fog-mid" />
      <div className="rain" />
      <div className="wet" />
      <div className="fog fog-fg" />
      <div className="grain" />
      <div className="vignette" />
    </div>
  );
}
