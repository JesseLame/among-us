import { roles, roleTeams, type Role, type SpecialRole, type Team } from '../shared/protocol.js';
import { enabledRoles, type Game } from './store/shared.js';

// How each role is handed out and played. Typed over every role, so a new one fails the
// build until it is described here.
type RoleRules = {
  // Fake tasks look identical to real ones but never count towards crew progress.
  fakeTasks: boolean;
  // Real (non-test) players needed in the round before this extra role is handed out.
  minPlayers: number;
  // Whether the room's other settings let this role play its part.
  playable?: (game: Game) => boolean;
};
export const roleRules: Record<Role, RoleRules> = {
  crewmate: { fakeTasks: false, minPlayers: 1 },
  impostor: { fakeTasks: true, minPlayers: 1 },
  security: { fakeTasks: false, minPlayers: 4 },
  // The Jester wins by a unanimous phone vote, so they need phone voting.
  jester: { fakeTasks: true, minPlayers: 5, playable: game => Boolean(game.phone_voting) },
  accomplice: { fakeTasks: true, minPlayers: 6 },
};
// The order extra roles are handed out in when only some of them fit.
const handOutOrder: SpecialRole[] = ['accomplice', 'security', 'jester'];

export const rolesOn = (team: Team) => roles.filter(role => roleTeams[role] === team);
// For SQL `role IN (...)`: only fixed role names, never input.
export const sqlRoles = (list: readonly Role[]) => list.map(role => `'${role}'`).join(', ');

// Picks the round's roles: one Impostor among the real players, then each extra role that is
// switched on, playable and fits, given to a random real Crewmate. Every extra role leaves at
// least two crew-team players. Test players stay Crewmates. Nobody is told a role was skipped.
export function chooseRoles(game: Game, players: { id: string; test: number }[], pick: (count: number) => number): Map<string, Role> {
  const real = players.filter(player => !player.test);
  const assigned = new Map<string, Role>(players.map(player => [player.id, 'crewmate']));
  const impostor = real[pick(real.length)].id;
  assigned.set(impostor, 'impostor');
  const on = enabledRoles(game);
  for (const role of handOutOrder) {
    const rules = roleRules[role];
    if (!on.includes(role) || real.length < rules.minPlayers || (rules.playable && !rules.playable(game))) continue;
    const candidates = real.filter(player => assigned.get(player.id) === 'crewmate');
    const crewTeam = players.filter(player => roleTeams[assigned.get(player.id)!] === 'crew').length;
    // Security stays on the crew; the others take a player away from it.
    if (!candidates.length || (roleTeams[role] !== 'crew' && crewTeam - 1 < 2)) continue;
    assigned.set(candidates[pick(candidates.length)].id, role);
  }
  return assigned;
}
