// Returneaza true daca userul are permisiuni privilegiate
// si nu ar trebui sa fie afectat de modulele auto de securitate

const PRIVILEGED_BITS = [
  8n,        // Administrator
  4n,        // Ban Members
  2n,        // Kick Members
  32n,       // Manage Messages
  32768n,    // Manage Roles
  16n,       // Manage Guild (Manage Server)
  8192n,     // Manage Channels
];

async function isPrivileged(api, guildId, userId) {
  try {
    // Verifica daca e server owner
    const guild = await api.guilds.get(guildId).catch(() => null);
    if (guild && String(guild.owner_id) === String(userId)) return true;

    // Ia member si rolurile lui
    const member = await api.guilds.getMember(guildId, userId).catch(() => null);
    if (!member) return false;

    const rolesData = await api.get(`/guilds/${guildId}/roles`).catch(() => []);
    const allRoles  = Array.isArray(rolesData) ? rolesData : (rolesData?.roles || []);
    const myRoleIds = new Set((member.roles || []).map(String));

    for (const role of allRoles) {
      if (String(role.id) === String(guildId) || myRoleIds.has(String(role.id))) {
        try {
          const perms = BigInt(role.permissions || '0');
          for (const bit of PRIVILEGED_BITS) {
            if ((perms & bit) === bit) return true;
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
  return false;
}

module.exports = { isPrivileged };
