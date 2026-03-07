const PRIVILEGED_BITS = [
  8n,      // Administrator
  4n,      // Ban Members
  2n,      // Kick Members
  32n,     // Manage Messages
  32768n,  // Manage Roles
  16n,     // Manage Guild
  8192n,   // Manage Channels
];

// Cache 30 secunde
const cache = new Map();
const TTL   = 30000;

async function isPrivileged(api, guildId, userId) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();

  if (cache.has(key)) {
    const { result, ts } = cache.get(key);
    if (now - ts < TTL) return result;
  }

  const set = (result) => { cache.set(key, { result, ts: now }); return result; };

  try {
    // 1. Verifica owner
    const guild = await api.guilds.get(guildId).catch(() => null);
    if (guild && String(guild.owner_id) === String(userId)) {
      console.log(`[PRIVILEGED] ${userId} is server owner — bypass`);
      return set(true);
    }

    // 2. Ia member
    const member = await api.guilds.getMember(guildId, userId).catch(() => null);
    if (!member) return set(false);

    // 3. Ia rolurile
    const rolesData = await api.guilds.getRoles(guildId).catch(() => []);
    const roles     = Array.isArray(rolesData) ? rolesData : [];
    const myRoleIds = new Set((member.roles || []).map(String));

    for (const role of roles) {
      const isEveryoneRole = String(role.id) === String(guildId);
      const isMemberRole   = myRoleIds.has(String(role.id));
      if (!isEveryoneRole && !isMemberRole) continue;

      try {
        const perms = BigInt(role.permissions || '0');
        for (const bit of PRIVILEGED_BITS) {
          if ((perms & bit) === bit) {
            console.log(`[PRIVILEGED] ${userId} has privileged bit ${bit} via role "${role.name}" — bypass`);
            return set(true);
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    console.error('[PRIVILEGED] Error:', err.message);
  }

  return set(false);
}

module.exports = { isPrivileged };
