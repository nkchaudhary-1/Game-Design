import { ROLE_NAMES, type PlayerColor, type PublicPlayer, type Role } from '@undercover/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { useCountdown } from '../useGame.js';
import { Silhouette, type Figure } from './Silhouette.js';

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

export function Avatar({ player, size = 36 }: { player: Pick<PublicPlayer, 'name' | 'color'>; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: COLOR_HEX[player.color], color: textOn(player.color), fontSize: size * 0.42 }}>
      {initials(player.name).toUpperCase()}
    </span>
  );
}

export function TopBar({ day, phase, onRules, showRules }: { day: number; phase: string | null; onRules: () => void; showRules: boolean }) {
  const chip = phase === 'night' ? `Night ${day}` : day > 0 && phase && phase !== 'waiting' && phase !== 'roleReveal' ? `Day ${day}` : null;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="wordmark" href="/" onClick={(e) => e.preventDefault()}>
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <path d="M14 30c0-6 7-9 18-9s18 3 18 9l-3 2H17z" fill="#151719" stroke="#C5C9CC" strokeWidth="2" />
            <path d="M20 23c0-9 4-13 12-13s12 4 12 13" fill="#151719" stroke="#C5C9CC" strokeWidth="2" />
            <path d="M12 56c2-12 9-17 20-17s18 5 20 17" fill="#151719" stroke="#C5C9CC" strokeWidth="2" />
          </svg>
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
  return (
    <div className={`role-card${compact ? ' compact' : ''}`} data-testid="role-card" data-role={role ?? undefined}>
      <div className="figure">
        <div className="halo" />
        <Silhouette figure={fig} />
        <div className="ground" />
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
