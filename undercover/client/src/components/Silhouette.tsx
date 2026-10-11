import type { Role } from '@undercover/shared';

export type Figure = Role | 'unknown' | 'god' | 'crowd';

const RIM = 'url(#rim)';

function Defs() {
  return (
    <defs>
      <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f2f3f4" stopOpacity="1" />
        <stop offset="0.55" stopColor="#a7acb0" stopOpacity="0.7" />
        <stop offset="1" stopColor="#5a5f64" stopOpacity="0.25" />
      </linearGradient>
      <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1a1d20" />
        <stop offset="1" stopColor="#050607" />
      </linearGradient>
    </defs>
  );
}

/**
 * Monochrome, backlit silhouettes. Faces always hidden. One shared camera, scale and
 * rim light so every role reads as photographed on the same foggy night.
 */
export function Silhouette({ figure, className }: { figure: Figure; className?: string }) {
  const common = { fill: 'url(#body)', stroke: RIM, strokeWidth: 2.2, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 200 260" className={className} role="img" aria-hidden="true">
      <Defs />
      {figure === 'traitor' && (
        <g>
          {/* fedora */}
          <path {...common} d="M58 62 Q100 44 142 62 L136 48 Q100 30 64 48 Z" />
          <path {...common} d="M70 50 Q100 36 130 50 L126 40 Q100 28 74 40 Z" />
          {/* head */}
          <path {...common} d="M82 62 Q100 58 118 62 L116 86 Q100 94 84 86 Z" />
          {/* overcoat with raised collar, hands in pockets */}
          <path {...common} d="M40 130 Q60 96 84 90 L100 100 L116 90 Q140 96 160 130 L170 250 L30 250 Z" />
          <path {...common} d="M84 90 L100 118 L116 90" fill="none" />
          <path d="M100 118 L100 250" stroke="#2a2d31" strokeWidth="1.2" />
        </g>
      )}
      {figure === 'doctor' && (
        <g>
          <path {...common} d="M84 56 Q100 50 116 56 L116 84 Q100 92 84 84 Z" />
          <path {...common} d="M48 134 Q66 98 86 92 L100 104 L114 92 Q134 98 152 134 L158 250 L42 250 Z" />
          <path {...common} d="M86 92 L100 120 L114 92" fill="none" />
          {/* medical bag */}
          <path {...common} d="M118 200 h46 v40 h-46 z" />
          <path d="M131 200 v-10 h20 v10" fill="none" stroke={RIM} strokeWidth="2" />
          <path d="M141 212 v16 M133 220 h16" stroke="#c5c9cc" strokeWidth="2" strokeOpacity="0.5" />
        </g>
      )}
      {figure === 'police' && (
        <g>
          {/* peaked cap */}
          <path {...common} d="M64 62 Q100 50 136 62 L130 54 Q100 42 70 54 Z" />
          <path {...common} d="M74 54 Q100 40 126 54 L124 46 Q100 34 76 46 Z" />
          <path {...common} d="M84 62 Q100 58 116 62 L116 86 Q100 94 84 86 Z" />
          <path {...common} d="M42 130 Q62 96 86 90 L100 100 L114 90 Q138 96 158 130 L166 250 L34 250 Z" />
          <path {...common} d="M86 90 L100 122 L114 90" fill="none" />
          {/* badge, subtle */}
          <path d="M70 128 l5 -6 l5 6 l-2 7 h-6 z" fill="#777d82" opacity="0.55" />
        </g>
      )}
      {figure === 'bodyguard' && (
        <g>
          <path {...common} d="M82 54 Q100 48 118 54 L118 82 Q100 90 82 82 Z" />
          {/* broad shoulders, clasped hands */}
          <path {...common} d="M26 128 Q56 92 84 88 L100 98 L116 88 Q144 92 174 128 L180 250 L20 250 Z" />
          <path {...common} d="M84 88 L100 116 L116 88" fill="none" />
          <path {...common} d="M80 176 q20 16 40 0 q6 10 -2 20 h-36 q-8 -10 -2 -20 z" />
        </g>
      )}
      {(figure === 'innocent' || figure === 'crowd') && (
        <g>
          {/* three townspeople, varied heights */}
          <g opacity="0.75">
            <path {...common} d="M30 98 Q44 92 58 98 L58 118 Q44 124 30 118 Z" />
            <path {...common} d="M10 160 Q24 128 44 122 L58 128 Q78 134 86 160 L90 250 L6 250 Z" />
          </g>
          <g>
            <path {...common} d="M88 70 Q102 64 116 70 L116 94 Q102 100 88 94 Z" />
            <path {...common} d="M70 72 Q102 58 134 72 L130 64 Q102 52 74 64 Z" />
            <path {...common} d="M58 142 Q76 106 94 100 L102 110 L112 100 Q132 106 150 142 L156 250 L52 250 Z" />
          </g>
          <g opacity="0.75">
            <path {...common} d="M146 106 Q160 100 174 106 L174 124 Q160 130 146 124 Z" />
            <path {...common} d="M124 164 Q140 136 156 130 L172 136 Q190 142 196 164 L198 250 L120 250 Z" />
          </g>
        </g>
      )}
      {figure === 'unknown' && (
        <g>
          {/* hooded, high-collared coat; only an outline */}
          <path {...common} d="M70 96 Q74 48 100 44 Q126 48 130 96 L124 108 L76 108 Z" />
          <path {...common} d="M40 140 Q60 104 86 100 L100 112 L114 100 Q140 104 160 140 L168 250 L32 250 Z" />
        </g>
      )}
      {figure === 'god' && (
        <g>
          <path {...common} d="M84 56 Q100 50 116 56 L116 84 Q100 92 84 84 Z" />
          <path {...common} d="M44 134 Q64 98 86 92 L100 104 L114 92 Q136 98 156 134 L162 250 L38 250 Z" />
          <path d="M60 128 Q100 150 140 128" fill="none" stroke={RIM} strokeWidth="1.6" strokeOpacity="0.6" />
          <circle cx="100" cy="30" r="14" fill="none" stroke={RIM} strokeWidth="1.5" strokeOpacity="0.6" />
        </g>
      )}
      {/* ground mist */}
      <ellipse cx="100" cy="250" rx="110" ry="14" fill="#c5c9cc" opacity="0.08" />
    </svg>
  );
}
