import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT ?? 5173);
const dataFile = process.env.DATA_FILE ?? join(root, 'data', 'world.json');

const srv = await startServer({ port, dataFile, dev, root });
console.log(`NEIGHBORHOOD · Maple Street (Block 01) — ${dev ? 'dev' : 'production'} server on http://localhost:${srv.port}  ·  state: ${dataFile}`);
const bye = async () => { await srv.close(); process.exit(0); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
