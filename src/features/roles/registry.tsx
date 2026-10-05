import type { Role, SpecialRole } from '../../../shared/protocol';
import type { Copy } from '../../i18n';

// Every role's card. Typed over every role, so a new one fails the build until it has a card.
type RoleCard = { symbol: string; name: (t: Copy) => string; brief: (t: Copy) => string };
export const roleCards: Record<Role, RoleCard> = {
  crewmate: { symbol: '✳', name: t => t.crewmate, brief: t => t.crewmateBrief },
  impostor: { symbol: '?', name: t => t.impostor, brief: t => t.impostorBrief },
  security: { symbol: '◎', name: t => t.security, brief: t => t.securityBrief },
  jester: { symbol: '☆', name: t => t.jester, brief: t => t.jesterBrief },
  accomplice: { symbol: '¿', name: t => t.accomplice, brief: t => t.accompliceBrief },
};
// The organiser's help for each extra role switch.
export const roleHelp: Record<SpecialRole, (t: Copy) => string> = {
  security: t => t.roleSecurityHelp,
  jester: t => t.roleJesterHelp,
  accomplice: t => t.roleAccompliceHelp,
};
