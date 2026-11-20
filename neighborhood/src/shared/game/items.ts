export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'] as const;
export const RARITY_COLORS = [0x9aa1a6, 0x7fb069, 0x5b9bd5, 0xa77ad1, 0xf0a93a, 0xe45a6e] as const;
export type Cat = 'jewelry' | 'electronics' | 'art' | 'luxury' | 'currency' | 'rare' | 'collectible' | 'secret';
export const CAT_NAMES: Record<Cat, string> = { jewelry: 'Jewelry', electronics: 'Electronics', art: 'Art', luxury: 'Luxury', currency: 'Currency', rare: 'Rare object', collectible: 'Collectible', secret: 'Secret find' };

export interface ItemDef { id: string; name: string; cat: Cat; rarity: 0 | 1 | 2 | 3 | 4 | 5; value: number; desc: string; origin: string }
const I = (id: string, name: string, cat: Cat, rarity: ItemDef['rarity'], value: number, origin: string, desc: string): ItemDef => ({ id, name, cat, rarity, value, desc, origin });

export const ITEMS: ItemDef[] = [
  I('silver_ring', 'Silver Ring', 'jewelry', 0, 90, 'Maple Street Jewellers', 'A plain band, worn smooth.'),
  I('pearl_necklace', 'Pearl Necklace', 'jewelry', 1, 260, 'Estate sale', 'Freshwater pearls on silk.'),
  I('gold_bracelet', 'Gold Bracelet', 'jewelry', 2, 640, 'Family heirloom', 'Heavy, hallmarked, engraved inside.'),
  I('diamond_choker', 'Diamond Choker', 'jewelry', 3, 1800, 'Auction lot 41', 'It throws light across the whole room.'),
  I('old_phone', 'Old Phone', 'electronics', 0, 70, 'Drawer', 'Still holds a charge, somehow.'),
  I('instant_camera', 'Instant Camera', 'electronics', 1, 210, 'Flea market', 'Film included. Probably expired.'),
  I('retro_console', 'Retro Console', 'electronics', 2, 540, 'Attic', 'Cartridges and both controllers.'),
  I('studio_drone', 'Studio Drone', 'electronics', 3, 1500, 'Online order', 'Gimbal camera, barely flown.'),
  I('watercolor', 'Watercolor Study', 'art', 1, 300, 'Local gallery', 'A rain-soaked Maple Street, signed in pencil.'),
  I('bronze_sculpture', 'Bronze Sculpture', 'art', 2, 780, 'Sculptor’s estate', 'A small bird, mid-flight.'),
  I('oil_landscape', 'Oil Landscape', 'art', 3, 2300, 'Private collection', 'Framed, with a gallery label on the back.'),
  I('steel_watch', 'Steel Watch', 'luxury', 1, 340, 'Watchmaker', 'Automatic movement, scratched crystal.'),
  I('handbag', 'Designer Handbag', 'luxury', 2, 700, 'Boutique', 'Numbered, with the dust bag.'),
  I('gold_watch', 'Gold Watch', 'luxury', 3, 2100, 'Inheritance', 'Engraved: “For forty years.”'),
  I('cash_bundle', 'Cash Bundle', 'currency', 0, 150, 'Biscuit tin', 'Rubber-banded notes.'),
  I('coin_set', 'Coin Set', 'currency', 1, 380, 'Collector', 'Twelve commemorative coins in a case.'),
  I('first_comic', 'First-Edition Comic', 'rare', 2, 900, 'Comic fair', 'Bagged and boarded. Never read.'),
  I('vinyl_test', 'Vinyl Test Pressing', 'rare', 3, 2600, 'Record label', 'One of five. Handwritten sleeve.'),
  I('figurine', 'Figurine', 'collectible', 0, 60, 'Shelf', 'A ceramic fox.'),
  I('trading_card', 'Trading Card', 'collectible', 1, 240, 'Card shop', 'Holographic, in a hard case.'),
  I('trophy', 'Trophy', 'collectible', 2, 560, 'Street fair', '“Best Hedge, 2019”.'),
  I('brass_key', 'Brass Key', 'secret', 2, 700, 'Found behind the crates', 'It fits nothing on this street. Yet.'),
  I('golden_pigeon', 'Golden Pigeon', 'secret', 3, 2000, 'Found on the roof', 'Someone loved this rooftop.'),
  I('maple_cup', 'Maple Cup', 'secret', 4, 3500, 'Found in the hidden garden', '“Best Kept Secret, Maple Street.”'),
  I('maple_diamond', 'The Maple Diamond', 'jewelry', 5, 9000, 'Unknown', 'Nobody agrees where it came from.'),
];
export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
/** Secrets in the world, by the order of `map.found`. */
export const FOUND_ITEMS = ['brass_key', 'golden_pigeon', 'maple_cup'];

export interface ItemInst { uid: number; def: string; hot?: boolean }
export const itemValue = (i: ItemInst) => ITEM_BY_ID[i.def]?.value ?? 0;

export interface ToolDef { id: string; name: string; price: number; uses: number; desc: string }
export const TOOLS: ToolDef[] = [
  { id: 'lockpicks', name: 'Lockpick set', price: 80, uses: 3, desc: 'Picks locks 35% faster. Three uses.' },
  { id: 'jammer', name: 'Signal jammer', price: 200, uses: 1, desc: 'Blinds cameras and motion sensors for 25 s. One use.' },
  { id: 'treats', name: 'Dog treats', price: 40, uses: 1, desc: 'Puts a guard dog to sleep for 45 s. One use.' },
  { id: 'softsoles', name: 'Soft soles', price: 120, uses: 3, desc: 'Cuts footstep noise. Three heists.' },
];
export const TOOL_BY_ID: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
