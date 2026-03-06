const fs   = require('fs');
const path = require('path');
const { getSettings } = require('../utils/db');

const commands = new Map();

const cmdDir = path.join(__dirname, '../commands');
for (const file of fs.readdirSync(cmdDir).filter(f => f.endsWith('.js'))) {
  const mod = require(path.join(cmdDir, file));
  const all = [mod, ...(mod.extra || [])].filter(c => c && c.name);
  for (const cmd of all) {
    const names = Array.isArray(cmd.names) ? cmd.names : [cmd.name];
    for (const name of names) commands.set(name.toLowerCase(), cmd);
    console.log(`[CMD] Loaded: ${names.join(', ')}`);
  }
}

function isOwner(userId) {
  return (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(userId);
}

async function memberHasPermission(api, guildId, message) {
  try {
    const member = message.member;

    // Varianta 1: Fluxer trimite permissions direct pe member (string bitfield)
    if (member && member.permissions !== undefined && member.permissions !== null) {
      try {
        const perms = BigInt(member.permissions);
        if (
          (perms & 8n)          ||
          (perms & 4n)          ||
          (perms & 2n)          ||
          (perms & 32n)         ||
          (perms & 268435456n)
        ) return true;
      } catch (_) {}
    }

    // Varianta 2: Calculeaza din roluri
    // IMPORTANT: convertim toate ID-urile la String() — pot veni ca number din API
    // si JS roteaza numerele mari (pierde precizia), deci nu folosim == ci String()
    const memberRoleIds = new Set((member?.roles || []).map(r => String(r)));

    const rolesData = await api.get(`/guilds/${guildId}/roles`);
    const allRoles  = Array.isArray(rolesData) ? rolesData : (rolesData?.roles || []);

    console.log(`[PERMS] member roles: ${[...memberRoleIds].join(', ')}`);
    console.log(`[PERMS] guild has ${allRoles.length} roles`);

    for (const role of allRoles) {
      const roleId     = String(role.id);
      const isEveryone = roleId === String(guildId);
      if (!isEveryone && !memberRoleIds.has(roleId)) continue;

      try {
        const perms = BigInt(role.permissions || '0');
        console.log(`[PERMS] checking role "${role.name}" (${roleId}) perms=${role.permissions}`);
        if (
          (perms & 8n)          ||  // ADMINISTRATOR
          (perms & 4n)          ||  // BAN_MEMBERS
          (perms & 2n)          ||  // KICK_MEMBERS
          (perms & 32n)         ||  // MANAGE_GUILD
          (perms & 268435456n)      // MANAGE_ROLES
        ) {
          console.log(`[PERMS] ALLOWED via role "${role.name}"`);
          return true;
        }
      } catch (_) {}
    }

    console.log('[PERMS] DENIED — no matching role with required perms');
    return false;
  } catch (err) {
    console.error('[PERMS ERROR]', err.message);
    return false;
  }
}

async function handleMessage(api, message) {
  if (!message.guild_id || message.author?.bot) return;

  const settings = await getSettings(message.guild_id);
  const prefix   = settings?.prefix || process.env.DEFAULT_PREFIX || '!';

  if (!message.content?.startsWith(prefix)) return;

  const args    = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmdName = args.shift().toLowerCase();

  // ── DEBUG COMMANDS ────────────────────────────────────────────────────────

  if (cmdName === 'debugperms') {
    const info = { author_id: message.author?.id, member: message.member };
    console.log('[DEBUGPERMS]', JSON.stringify(info, null, 2));
    await api.channels.createMessage(message.channel_id, {
      content: '```json\n' + JSON.stringify(info, null, 2).slice(0, 1800) + '\n```'
    });
    return;
  }

  if (cmdName === 'debugroles') {
    try {
      const rolesData     = await api.get(`/guilds/${message.guild_id}/roles`);
      const allRoles      = Array.isArray(rolesData) ? rolesData : (rolesData?.roles || []);
      const memberRoleIds = new Set((message.member?.roles || []).map(r => String(r)));

      const lines = allRoles.map(r => {
        const mine = memberRoleIds.has(String(r.id)) ? '[YOU]' : '     ';
        return `${mine} ${r.name.padEnd(25)} ${r.permissions}`;
      });

      console.log('[DEBUGROLES] member.roles:', [...memberRoleIds]);
      console.log('[DEBUGROLES]\n' + lines.join('\n'));

      const output = [
        `**Rolurile tale:** ${[...memberRoleIds].join(', ') || '(none)'}`,
        '```',
        lines.join('\n').slice(0, 1500),
        '```'
      ].join('\n');

      await api.channels.createMessage(message.channel_id, { content: output });
    } catch (err) {
      console.error('[DEBUGROLES ERROR]', err.message);
      await api.channels.createMessage(message.channel_id, {
        content: '❌ Eroare la debugroles: `' + err.message + '`'
      });
    }
    return;
  }

  // ── COMENZI NORMALE ───────────────────────────────────────────────────────

  const cmd = commands.get(cmdName);
  if (!cmd) return;

  if (cmd.permissions && !isOwner(message.author.id)) {
    const allowed = await memberHasPermission(api, message.guild_id, message);
    if (!allowed) {
      await api.channels.createMessage(message.channel_id, {
        content: '❌ Nu ai permisiuni. Ai nevoie de Administrator, Ban Members, Kick Members sau Manage Server.'
      });
      return;
    }
  }

  if (cmd.ownerOnly && !isOwner(message.author.id)) {
    await api.channels.createMessage(message.channel_id, {
      content: '❌ Doar owner-ul botului poate folosi această comandă.'
    });
    return;
  }

  try {
    await cmd.execute({
      api,
      message,
      args,
      guildId:   message.guild_id,
      channelId: message.channel_id,
      author:    message.author,
    });
  } catch (err) {
    console.error(`[CMD ERROR] ${cmdName}:`, err.message);
    await api.channels.createMessage(message.channel_id, {
      content: '❌ Eroare: ' + err.message
    }).catch(() => {});
  }
}

module.exports = { handleMessage };
