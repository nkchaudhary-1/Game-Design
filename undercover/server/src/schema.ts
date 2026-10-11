import { z } from 'zod';
import { NAME_MAX, PLAYER_COLORS, PLAYER_COUNT_VALUES, ROOM_CODE_LENGTH } from '@undercover/shared';

const name = z.string().min(1).max(NAME_MAX * 3);
const color = z.enum(PLAYER_COLORS);
const code = z.string().length(ROOM_CODE_LENGTH);
const id = z.string().min(1).max(64);

export const settingsSchema = z.object({
  mode: z.enum(['player', 'god']),
  targetCount: z.union(PLAYER_COUNT_VALUES.map((n) => z.literal(n)) as [z.ZodLiteral<5>, z.ZodLiteral<7>, z.ZodLiteral<9>, z.ZodLiteral<11>]),
  bodyguard: z.boolean(),
  discussionMinutes: z.number().int().min(1).max(30).nullable(),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('createRoom'), name, color, settings: settingsSchema }),
  z.object({ type: z.literal('joinRoom'), code, name, color }),
  z.object({ type: z.literal('rejoin'), code, playerId: id, secret: z.string().min(1).max(128) }),
  z.object({ type: z.literal('leaveRoom') }),
  z.object({ type: z.literal('startGame') }),
  z.object({ type: z.literal('ackReveal') }),
  z.object({ type: z.literal('ackNarrator') }),
  z.object({ type: z.literal('nightAction'), targetId: id.nullable(), confirm: z.boolean() }),
  z.object({ type: z.literal('castVote'), targetId: id }),
  z.object({ type: z.literal('advancePhase') }),
  z.object({ type: z.literal('publishAnnouncement'), text: z.string().max(1000) }),
  z.object({ type: z.literal('ping') }),
]);

export type ParsedClientMessage = z.infer<typeof clientMessageSchema>;

export const MAX_MESSAGE_BYTES = 8 * 1024;
