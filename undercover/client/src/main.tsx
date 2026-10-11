import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';
import { startParallax } from './parallax.js';

startParallax();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
