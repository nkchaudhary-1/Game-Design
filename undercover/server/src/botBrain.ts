/**
 * The decision-making half of a headless player, with no transport attached.
 * Given the latest personalised view it returns the legal messages to send.
 * Shared by the ws-based Bot (simulations) and the in-browser solo demo.
 */
import type { ClientMessage, RoomView } from '@undercover/shared';

export interface BrainOptions {
  rng?: () => number;
  /** Advance phases quickly when this bot is host/God. */
  impatient?: boolean;
}

export class BotBrain {
  private lastActionKey = '';
  private rng: () => number;
  constructor(private opts: BrainOptions = {}) {
    this.rng = opts.rng ?? Math.random;
  }

  private pick<T>(items: T[]): T {
    return items[Math.floor(this.rng() * items.length)];
  }

  private once(key: string): boolean {
    if (this.lastActionKey === key) return false;
    this.lastActionKey = key;
    return true;
  }

  /** Decide what to do with the latest view. Only legal moves, exactly once per step. */
  act(view: RoomView): ClientMessage[] {
    const me = view.players.find((p) => p.id === view.youId);
    if (!me) return [];
    const controller = view.isHost || view.isGod;
    const stepKey = `${view.phase}:${view.day}:${view.night?.step ?? ''}:${view.announcement === null ? 'pending' : 'pub'}`;
    switch (view.phase) {
      case 'waiting':
        return [];
      case 'roleReveal':
        if (!view.acked && !view.isGod && this.once(stepKey)) return [{ type: 'ackReveal' }];
        return [];
      case 'night': {
        const night = view.night;
        if (!night) return [];
        if (night.step === 'narrator') {
          if (!night.narratorAcked && !view.isGod && this.once(stepKey)) return [{ type: 'ackNarrator' }];
          return [];
        }
        if (night.canAct && night.yourPick && !night.yourPick.confirmed && night.legalTargets?.length && this.once(stepKey)) {
          const target = this.pick(night.legalTargets);
          const out: ClientMessage[] = [];
          if (view.you.role === 'traitor') out.push({ type: 'nightAction', targetId: target, confirm: false });
          out.push({ type: 'nightAction', targetId: target, confirm: true });
          return out;
        }
        return [];
      }
      case 'dayReveal':
      case 'voteResult': {
        if (!controller) return [];
        if (view.god?.pendingAnnouncement !== undefined && view.announcement === null) {
          if (this.once(stepKey + ':publish')) return [{ type: 'publishAnnouncement', text: view.god.pendingAnnouncement + ' (The narrator nods.)' }];
          return [];
        }
        if ((view.isGod || this.opts.impatient) && this.once(stepKey + ':advance')) return [{ type: 'advancePhase' }];
        return [];
      }
      case 'discussion':
        if (controller && this.opts.impatient !== false && this.once(stepKey)) return [{ type: 'advancePhase' }];
        return [];
      case 'voting': {
        if (view.isGod || !me.alive || view.voteTally?.yourVote) return [];
        const targets = view.players.filter((p) => p.alive && p.id !== view.youId && p.id !== view.godId);
        if (targets.length && this.once(stepKey)) return [{ type: 'castVote', targetId: this.pick(targets).id }];
        return [];
      }
      default:
        return [];
    }
  }
}
