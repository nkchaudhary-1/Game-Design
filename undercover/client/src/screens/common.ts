import type { ClientMessage, Role, RoomView } from '@undercover/shared';
import type { GameError } from '../ws.js';

export interface ScreenProps {
  view: RoomView;
  send: (m: ClientMessage) => void;
  offset: number;
  error: GameError | null;
  clearError: () => void;
}

export function me(view: RoomView) {
  return view.players.find((p) => p.id === view.youId)!;
}

export function nameOf(view: RoomView, id: string | null | undefined): string {
  if (!id) return 'nobody';
  return view.players.find((p) => p.id === id)?.name ?? 'someone';
}

export const VERBS: Record<Exclude<Role, 'innocent'>, { verb: string; selected: string; confirm: string; prompt: string }> = {
  traitor: { verb: 'Kill', selected: 'Marked', confirm: 'Confirm the kill', prompt: 'Choose who dies tonight.' },
  doctor: { verb: 'Protect', selected: 'Protecting', confirm: 'Confirm protection', prompt: 'Choose who you protect tonight.' },
  bodyguard: { verb: 'Guard', selected: 'Guarding', confirm: 'Confirm the guard', prompt: 'Choose who you guard tonight.' },
  police: { verb: 'Investigate', selected: 'Investigating', confirm: 'Confirm investigation', prompt: 'Choose who you investigate tonight.' },
};

export function inviteLink(code: string): string {
  return `${location.origin}/join/${code}`;
}
