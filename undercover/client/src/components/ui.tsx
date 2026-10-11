import { ROLE_NAMES, type PlayerColor, type PublicPlayer, type Role } from '@undercover/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { avatarArt, isMissing, markMissing, ROLE_ART } from '../art.js';
import { useCountdown } from '../useGame.js';
import { Silhouette, type Figure } from './Silhouette.js';

/** An image that reports when it is missing so the caller can fall back. */
export function Art({ src, alt = '', className, onMissing }: { src: string; alt?: string; className?: string; onMissing?: () => void }) {
  const [failed, setFailed] = useState(() => isMissing(src));
  if (failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => {
        markMissing(src);
        setFailed(true);
        onMissing?.();
      }}
    />
  );
}

export const COLOR_HEX: Record<PlayerColor, string> = {
  moon: '#f2f3f4',
  silver: '#c5c9cc',
  steel: '#9aa1a7',
  fog: '#777d82',
  ash: '#5e6368',
  graphite: '#45494e',
  smoke: '#8a8f94',
  bone: '#dedad2',
  pewter: '#6d7378',
  slate: '#555b61',
  chrome: '#b3b8bc',
};

export function textOn(color: PlayerColor): string {
  return ['moon', 'silver', 'bone', 'chrome', 'smoke', 'steel'].includes(color) ? '#050607' : '#f2f3f4';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '');
}

export function Avatar({ player, size = 44, square }: { player: Pick<PublicPlayer, 'name' | 'color'> & { avatar?: number }; size?: number; square?: boolean }) {
  const src = player.avatar !== undefined && player.avatar >= 0 ? avatarArt(player.avatar) : null;
  const [photo, setPhoto] = useState(() => !!src && !isMissing(src));
  return (
    <span className={`avatar${square ? ' square' : ''}${photo ? ' photo' : ''}`} style={{ width: size, height: size, background: COLOR_HEX[player.color], color: textOn(player.color), fontSize: size * 0.38 }}>
      {photo && src ? <Art src={src} onMissing={() => setPhoto(false)} /> : initials(player.name).toUpperCase()}
    </span>
  );
}

export function TopBar({ day, phase, onRules, showRules }: { day: number; phase: string | null; onRules: () => void; showRules: boolean }) {
  const chip = phase === 'night' ? `Night ${day}` : day > 0 && phase && phase !== 'waiting' && phase !== 'roleReveal' ? `Day ${day}` : null;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="wordmark" href="/" onClick={(e) => e.preventDefault()}>
          <HatIcon />
          Undercover
        </a>
        {chip && <span className={`chip${phase === 'night' ? '' : ' live'}`}>{chip}</span>}
        <span className="spacer" />
        {showRules && (
          <button className="pill" onClick={onRules} aria-label="Rules">
            Rules
          </button>
        )}
      </div>
    </header>
  );
}

export function HatIcon() {
  return (
    <svg viewBox="0 0 64 40" aria-hidden="true" className="hat">
      <path d="M4 30 Q32 40 60 30 L58 26 Q32 34 6 26 Z" fill="#c5c9cc" />
      <path d="M16 27 Q14 12 24 8 Q32 5 40 8 Q50 12 48 27 Q32 32 16 27 Z" fill="#0b0d0f" stroke="#c5c9cc" strokeWidth="2" />
      <path d="M17 22 Q32 27 47 22" fill="none" stroke="#c5c9cc" strokeWidth="2" />
    </svg>
  );
}

export function Chevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="chevron">
      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CtaBar({ children }: { children: ReactNode }) {
  return (
    <div className="ctabar">
      <div className="ctabar-inner">{children}</div>
    </div>
  );
}

export function InlineError({ error, onDismiss }: { error: { message: string; at: number } | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(t);
  }, [error, onDismiss]);
  if (!error) return null;
  return (
    <div className="inline-error" role="alert">
      {error.message}
    </div>
  );
}

export function Banner({ status }: { status: string }) {
  if (status === 'open') return null;
  return (
    <div className="banner" aria-live="polite">
      <div>
        <span className="spinner" />
        {status === 'connecting' ? 'Connecting...' : 'Reconnecting...'}
      </div>
    </div>
  );
}

function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function Timer({ endsAt, totalMs, offset, label, urgentMs = 10_000 }: { endsAt: number | null; totalMs: number | null; offset: number; label: string; urgentMs?: number }) {
  const left = useCountdown(endsAt, offset);
  if (left === null || endsAt === null) return null;
  const pct = totalMs ? Math.max(0, Math.min(100, (left / totalMs) * 100)) : 0;
  const urgent = left <= urgentMs && left > 0;
  return (
    <div className={`timer${urgent ? ' urgent' : ''}`} data-testid="timer">
      <div className="readout">
        <span className="eyebrow">{label}</span>
        <span className="time mono">{fmt(left)}</span>
      </div>
      <div className="bar" aria-hidden="true">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function RoleCard({ role, figure, title, line, compact, children }: { role?: Role | null; figure?: Figure; title?: string; line?: string; compact?: boolean; children?: ReactNode }) {
  const fig: Figure = figure ?? role ?? 'unknown';
  const name = title ?? (role ? ROLE_NAMES[role] : 'Unknown');
  const src = ROLE_ART[fig === 'crowd' ? 'innocent' : fig === 'god' ? 'unknown' : fig];
  const [photo, setPhoto] = useState(() => !isMissing(src));
  return (
    <div className={`role-card${compact ? ' compact' : ''}${photo ? ' photo' : ''}`} data-testid="role-card" data-role={role ?? undefined}>
      <div className="figure">
        {photo ? (
          <Art src={src} className="photo" onMissing={() => setPhoto(false)} />
        ) : (
          <>
            <div className="halo" />
            <Silhouette figure={fig} />
            <div className="ground" />
          </>
        )}
      </div>
      <div className="caption">
        <div className="role-name">{name}</div>
        {line && <p className="narration small">{line}</p>}
        {children}
      </div>
    </div>
  );
}

export function PlayerRow({
  player,
  youId,
  right,
  sub,
  selected,
  onClick,
  showRole,
}: {
  player: PublicPlayer;
  youId: string;
  right?: ReactNode;
  sub?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  showRole?: boolean;
}) {
  const self = player.id === youId;
  const cls = ['player-row', !player.alive ? 'dead' : '', selected ? 'selected' : '', self ? 'self' : ''].filter(Boolean).join(' ');
  const inner = (
    <>
      <Avatar player={player} />
      <div className="name">
        <strong>
          {player.name}
          {self ? ' (you)' : ''}
        </strong>
        <span className="sub">
          {sub ??
            [
              !player.alive ? 'Eliminated' : null,
              !player.connected ? 'Disconnected' : null,
              showRole !== false && player.role ? ROLE_NAMES[player.role] : null,
            ]
              .filter(Boolean)
              .join(' · ')}
        </span>
      </div>
      {player.isHost && <span className="badge">Host</span>}
      {right}
    </>
  );
  return (
    <div
      className={cls}
      data-testid="player-row"
      data-player-id={player.id}
      data-self={self}
      data-alive={player.alive}
      data-revealed-role={showRole !== false && player.role ? player.role : undefined}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      {inner}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export function ClosedEye() {
  return (
    <svg className="eye-closed" viewBox="0 0 120 60" aria-hidden="true">
      <path d="M10 30 Q60 70 110 30" fill="none" stroke="#c5c9cc" strokeWidth="2.5" strokeLinecap="round" />
      <g stroke="#777d82" strokeWidth="2" strokeLinecap="round">
        <path d="M30 42 l-6 10" />
        <path d="M60 50 l0 11" />
        <path d="M90 42 l6 10" />
      </g>
    </svg>
  );
}
