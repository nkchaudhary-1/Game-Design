// Vercel function: every /api/* request lands here (see vercel.json for how static pages are served).
import crypto from 'node:crypto';
import { createRedisStore } from '../lib/redis-store.js';
import { createApi, nodeHandler } from '../lib/serverless.js';

// Vercel's Upstash Redis integration sets KV_REST_API_*; a database created at upstash.com directly uses UPSTASH_REDIS_REST_*.
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export default nodeHandler(
  createApi({
    store: url && token ? createRedisStore({ url, token }) : null,
    defaultRoster: [], // the host types the guest list into the projector screen; it is kept in Redis
    hostKey: process.env.HOST_KEY,
    randomId: () => crypto.randomUUID(),
  }),
);
