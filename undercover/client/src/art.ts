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

/** Layered role art: a darkened scene, the ornamental frame, and the figure on black (screen-blended on top). */
export const ROLE_LAYERS = (figure: Role | 'unknown') => ({
  scene: art(`role-${figure}-scene.jpg`),
  figure: art(`role-${figure}-figure.webp`),
  frame: art('frame.png'),
});

export const AVATAR_COUNT = 11;
export function avatarArt(index: number): string {
  const n = ((index % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
  return art(`avatar-${String(n + 1).padStart(2, '0')}.jpg`);
}

/** Large 3:4 portrait for the pass-and-play gate; same numbering as the avatars. */
export function portraitArt(index: number): string {
  const n = ((index % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
  return art(`portrait-${String(n + 1).padStart(2, '0')}.webp`);
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
