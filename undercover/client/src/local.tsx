import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocalApp } from './local/LocalApp.js';
import './styles.css';
import { startParallax } from './parallax.js';

startParallax();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocalApp />
  </React.StrictMode>,
);
