import { buildBlade } from '../src/blades/BladeFactory';
import { playMatch } from '../src/sim/headless';

const a = buildBlade('ravok', { level: 7 });
const b = buildBlade('phantom', { level: 7 });
console.log('Ravok combat', JSON.stringify(a.combat));
console.log('Phantom combat', JSON.stringify(b.combat));
const t0 = performance.now();
const { result, duration, match } = await playMatch([a, b], {
  seed: 1,
  onEvent: (e) => { if (e.type === 'hit' || e.type === 'ko' || e.type === 'super' || e.type === 'ability') console.log(e.type, JSON.stringify(e).slice(0, 140)); },
});
console.log('result', JSON.stringify(result), 'sim', duration.toFixed(1), 's in', (performance.now() - t0).toFixed(0), 'ms');
void match;
