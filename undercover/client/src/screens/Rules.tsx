import { ROLE_FLAVOR, ROLE_NAMES, ROLE_POWER, ROLES } from '@undercover/shared';
import { RoleCard } from '../components/ui.js';

export function Rules({ onBack }: { onBack: () => void }) {
  return (
    <main className="screen rules" data-screen="rules">
      <div className="row between">
        <h1>Rules</h1>
        <button className="pill" onClick={onBack} data-testid="rules-back">
          Back
        </button>
      </div>
      <p className="narration small">A city of strangers. A few of them want you dead. Find them before they find you.</p>

      <h2>How a game runs</h2>
      <ul>
        <li>The host creates a room and shares the link. 5 to 11 players join on their phones. Nobody needs an account.</li>
        <li>When the host starts, everyone secretly receives a role. Only you see yours.</li>
        <li>
          Each round has a <strong>night</strong> and a <strong>day</strong>. At night, roles with powers act in secret. By day, everyone discusses, then votes to eliminate someone.
        </li>
        <li>The Traitors win when they are at least half of everyone left alive. The town wins when every Traitor is gone.</li>
      </ul>

      <h2>Roles</h2>
      <table>
        <thead>
          <tr>
            <th>Players</th>
            <th>Traitors</th>
            <th>Doctor</th>
            <th>Police</th>
            <th>Bodyguard</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>5 to 6</td>
            <td>1</td>
            <td>1</td>
            <td>0</td>
            <td>never</td>
          </tr>
          <tr>
            <td>7 to 9</td>
            <td>2</td>
            <td>1</td>
            <td>1</td>
            <td>optional</td>
          </tr>
          <tr>
            <td>10 to 11</td>
            <td>3</td>
            <td>1</td>
            <td>1</td>
            <td>optional</td>
          </tr>
        </tbody>
      </table>
      <p>Everyone else is Innocent.</p>

      {ROLES.map((r) => (
        <RoleCard key={r} role={r} compact title={ROLE_NAMES[r]} line={ROLE_FLAVOR[r]}>
          <p className="lead">{ROLE_POWER[r]}</p>
        </RoleCard>
      ))}

      <h2>Night</h2>
      <ul>
        <li>On the first night, the narrator says "Everyone, close your eyes." The Traitors learn who their teammates are. Everyone else sees nothing.</li>
        <li>Traitors agree on one target. Every Traitor sees the team's picks live; the pick with the most votes wins, ties go to the earliest pick, and if nobody picks, the game picks for them.</li>
        <li>The Doctor protects one player, the Bodyguard guards one player, the Police investigate one player. All in secret.</li>
        <li>
          Resolution order: if the Doctor protected the target, <strong>nobody dies</strong>. Otherwise, if the Bodyguard guarded the target, <strong>the Bodyguard dies instead</strong>. Otherwise the target dies.
        </li>
        <li>Players without a power wait just as long as everyone else, so nobody can tell who acted.</li>
      </ul>

      <h2>Day</h2>
      <ul>
        <li>The city wakes. You only learn who died, never how or why. The Police's result stays private; they may share it, or lie.</li>
        <li>Discussion is timed (3, 5 or 7 minutes by player count, or the host's custom length). The host may move to the vote early.</li>
        <li>Everyone alive casts one vote. No voting for yourself, no changing your mind. Votes are counted live, but nobody sees who voted for whom.</li>
        <li>The most votes eliminates that player and reveals their role. A tie eliminates no one.</li>
      </ul>

      <h2>God mode</h2>
      <p>The host can instead be God: a narrator who sees every role, never plays or votes, writes the public announcements, and moves the game along. Players still act for themselves.</p>

      <h2>Dropping out</h2>
      <p>Lose connection and your seat is kept for 90 seconds. Come back and you pick up exactly where you were. Stay gone and the game plays on without you: your actions time out and your vote abstains.</p>
    </main>
  );
}
