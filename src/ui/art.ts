// Reference art from the supplied pack (see tools/prep-art.sh). The blade renders keep their cream paper
// background and are multiplied onto cream cards; the arena shots are used as selection thumbnails.
import ironWarden from '../assets/art/blades/iron-warden.jpg';
import blazefang from '../assets/art/blades/blazefang.jpg';
import ravok from '../assets/art/blades/ravok.jpg';
import riftclaw from '../assets/art/blades/riftclaw.jpg';
import coreArena from '../assets/art/arenas/core-pit.jpg';
import crystal from '../assets/art/arenas/crystal-arena.jpg';
import elevation from '../assets/art/arenas/elevation-ring.jpg';
import gravity from '../assets/art/arenas/gravity-well.jpg';
import lava from '../assets/art/arenas/lava-ring.jpg';
import magnetic from '../assets/art/arenas/magnetic-core.jpg';
import shift from '../assets/art/arenas/shift-floor.jpg';
import wind from '../assets/art/arenas/wind-tunnel.jpg';

/** Hero renders that exist for some blades; everything else falls back to a 3D snapshot. */
export const BLADE_ART: Record<string, string> = { ravok, blazefang, riftclaw, 'iron-warden': ironWarden };

export const ARENA_ART: Record<string, string> = {
  'core-pit': coreArena, 'elevation-ring': elevation, 'magnetic-core': magnetic, 'crystal-arena': crystal,
  'shift-floor': shift, 'wind-tunnel': wind, 'lava-ring': lava, 'gravity-well': gravity,
};
