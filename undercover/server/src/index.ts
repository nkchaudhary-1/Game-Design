import { createServer } from './server.js';
import { MemoryStore, RedisStore, type RoomStore } from './store.js';

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL?.trim();
  let store: RoomStore;
  if (redisUrl) {
    store = await RedisStore.connect(redisUrl);
    console.log('[undercover] using Redis store');
  } else {
    store = new MemoryStore();
    console.log('[undercover] using in-memory store (set REDIS_URL to persist rooms)');
  }
  const server = await createServer({
    store,
    log: (line) => console.log(`[undercover] ${line}`),
  });
  console.log(`[undercover] listening on :${server.port}`);

  const shutdown = async (signal: string) => {
    console.log(`[undercover] ${signal} received, shutting down`);
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[undercover] fatal', err);
  process.exit(1);
});
