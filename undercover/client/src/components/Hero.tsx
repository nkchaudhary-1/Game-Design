import { useState } from 'react';
import { art } from '../art.js';
import { Silhouette } from './Silhouette.js';
import { Art } from './ui.js';

export function Hero({ tagline, lead }: { tagline: string; lead: string }) {
  const [photo, setPhoto] = useState(true);
  return (
    <section className={`hero-art${photo ? ' photo' : ''}`}>
      <div className="hero-media" aria-hidden="true">
        {photo ? <Art src={art('hero.jpg')} onMissing={() => setPhoto(false)} /> : <Silhouette figure="traitor" className="hero-fallback" />}
        <div className="hero-lamp" />
      </div>
      <div className="hero-copy">
        <div className="wordmark-big textured">Undercover</div>
        <p className="narration">{tagline}</p>
        <p className="lead">{lead}</p>
      </div>
    </section>
  );
}

export function Skyline() {
  const [photo, setPhoto] = useState(true);
  if (!photo) return null;
  return (
    <div className="skyline-strip" aria-hidden="true">
      <Art src={art('skyline.jpg')} onMissing={() => setPhoto(false)} />
    </div>
  );
}

