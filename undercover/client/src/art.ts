/**
 * Photographic art. Every path resolves relative to the build base so the same code works
 * at "/" (online server) and "./" (static local build). Missing files fall back to the
 * SVG silhouettes and initials in the components.
 */
import type { Role } from '@undercover/shared';

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
export const art = (name: string): string => `${base}art/${name}`;

export const ROLE_ART: Record<Role | 'unknown', string> = {
  traitor: art('role-traitor.jpg'),
  doctor: art('role-doctor.jpg'),
  police: art('role-police.jpg'),
  bodyguard: art('role-bodyguard.jpg'),
  innocent: art('role-innocent.jpg'),
  unknown: art('role-unknown.jpg'),
};

export const AVATAR_COUNT = 11;
export function avatarArt(index: number): string {
  const n = ((index % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
  return art(`avatar-${String(n + 1).padStart(2, '0')}.jpg`);
}

/** Stable portrait index for a player: their position at the table. */
export function avatarIndexFor(players: { id: string }[], id: string): number {
  const i = players.findIndex((p) => p.id === id);
  return i < 0 ? 0 : i;
}

/** Track which images exist so fallbacks render instantly after the first miss. */
const missing = new Set<string>();
export const isMissing = (src: string): boolean => missing.has(src);
export const markMissing = (src: string): void => {
  missing.add(src);
};
