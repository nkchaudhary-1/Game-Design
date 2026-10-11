const FIRST = [
  'Smoky', 'Velvet', 'Lucky', 'Shady', 'Dapper', 'Sly', 'Foggy', 'Midnight', 'Rusty', 'Silent',
  'Crooked', 'Nimble', 'Grumpy', 'Slick', 'Pinstripe', 'Whispering', 'Wobbly', 'Hollow', 'Dusty', 'Moody',
];
const LAST = [
  'Fedora', 'Malone', 'Marlowe', 'Nickels', 'Doyle', 'Cigarette', 'Trenchcoat', 'Lamplight', 'Umbrella', 'Alibi',
  'Scarpelli', 'Vanderbilt', 'Pockets', 'Cufflink', 'Harmonica', 'Barstool', 'Rainboot', 'Gloves', 'Ledger', 'Suitcase',
];

export function suggestName(rng: () => number = Math.random): string {
  const a = FIRST[Math.floor(rng() * FIRST.length)];
  const b = LAST[Math.floor(rng() * LAST.length)];
  return `${a} ${b}`;
}

export const NAME_MAX = 20;

/** Trim, collapse whitespace, strip control characters, cap length. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

/** De-duplicate a name against the names already in a room ("Sly Doyle" -> "Sly Doyle 2"). */
export function uniqueName(name: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) {
    const candidate = `${name.slice(0, NAME_MAX - 3)} ${i}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${name.slice(0, NAME_MAX - 5)} ${Math.floor(Math.random() * 1000)}`;
}

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function makeRoomCode(rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    s += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
  }
  return s;
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}
