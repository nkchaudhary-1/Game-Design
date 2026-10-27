// Reference art from the supplied pack (see tools/prep-art.sh). The arena shots are used as selection thumbnails; the blade
// renders in src/assets/art/blades are the style reference for the models and are not shown in the game.
import coreArena from '../assets/art/arenas/core-pit.jpg';
import crystal from '../assets/art/arenas/crystal-arena.jpg';
import elevation from '../assets/art/arenas/elevation-ring.jpg';
import gravity from '../assets/art/arenas/gravity-well.jpg';
import lava from '../assets/art/arenas/lava-ring.jpg';
import magnetic from '../assets/art/arenas/magnetic-core.jpg';
import shift from '../assets/art/arenas/shift-floor.jpg';
import wind from '../assets/art/arenas/wind-tunnel.jpg';

/** Hero renders per blade. None now: every card, preview and lobby slot shows the game's own Blender model, so what you pick is what you fight with. */
export const BLADE_ART: Record<string, string> = {};

export const ARENA_ART: Record<string, string> = {
  'core-pit': coreArena, 'elevation-ring': elevation, 'magnetic-core': magnetic, 'crystal-arena': crystal,
  'shift-floor': shift, 'wind-tunnel': wind, 'lava-ring': lava, 'gravity-well': gravity,
};
