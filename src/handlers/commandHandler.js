const fs   = require('fs');
const path = require('path');
const { getSettings } = require('../utils/db');

const commands = new Map();

// Incarca comenzile — fiecare fisier exporta un obiect principal + optional .extra[]
// Evitam dublurile: nu adaugam acelasi obiect de 2 ori
const cmdDir = path.join(__dirname, '../commands');
for (const file of fs.readdirSync(cmdDir).filter(f => f.endsWith('.js'))) {
  const mod  = require(path.join(cmdDir, file));
  const list = mod.extra ? mod.extra : [mod]; // daca are .extra, folosim DOAR extra (include si principalul)
  // Daca are .extra, principalul e deja inclus in lista extra? Nu neaparat — adaugam tot
  const all  = mod.extra ? [mod, ...mod.extra] : [mod];
  // Deduplicare prin referinta
  const seen = new Set();
  for (const cmd of all) {
    if (!cmd || !cmd.name || seen.has(cmd)) continue;
    seen.add(cmd);
    const names = Array.isArray(cmd.names) ? cmd.names : [cmd.name];
    for (const name of names) commands.set(name.toLowerCase(), cmd);
    console.log(`[CMD] Loaded: ${names.join(', ')}`);
  }
}

function isOwner(userId) {
  return (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(userId);
}


const ALLOWED_BITS = [
  8n, 4n, 2n, 32n, 268435456n, 8192n, 16n,
];

function checkBits(permsStr) {
  try {
    const p = BigInt(permsStr || '0');
    for (const bit of ALLOWED_BITS) {
      if ((p & bit) === bit) return true;
    }
  } catch (_) {}
  return false;
}

// Helper: calculeaza permisiuni din roleIds + allRoles array
function calcPerms(roleIds, allRoles, guildId) {
  const myIds = new Set((roleIds || []).map(String));
  let perms = 0n;
  for (const role of (allRoles || [])) {
    if (String(role.id) === String(guildId) || myIds.has(String(role.id))) {
      try { perms |= BigInt(role.permissions || '0'); } catch (_) {}
    }
  }
  return perms;
}

async function memberHasPermission(api, guildId, message) {
  const userId = String(message.author?.id || '');
  const member = message.member;
  const gId    = String(guildId);

  const { ownerCache: ownerMap } = require('../utils/isPrivileged');
  const { rolesCache }           = require('../utils/cache');

  // ── PAS 1: Bot owner ──────────────────────────────────────────────────────
  // Local check din .env — nu poate esua niciodata
  if (isOwner(userId)) return true;

  // ── PAS 2: Server owner din cache ─────────────────────────────────────────
  // ownerMap e populat la GUILD_CREATE prin setOwner() — zero API calls
  // Daca nu e in cache (bot era offline la adaugare pe server), incearca guild fetch
  const cachedOwner = ownerMap?.get(gId);
  if (cachedOwner) {
    if (String(cachedOwner) === userId) return true;
  } else {
    try {
      const guild = await api.guilds.get(gId);
      if (guild?.owner_id) {
        ownerMap?.set(gId, String(guild.owner_id));
        if (String(guild.owner_id) === userId) return true;
      }
    } catch (_) {}
  }

  // ── PAS 3: member.permissions din event ───────────────────────────────────
  // Fluxer uneori include permisiunile calculate in payload-ul MESSAGE_CREATE
  // Cel mai rapid — zero API calls, un singur BigInt check
  if (member?.permissions != null) {
    if (checkBits(String(member.permissions))) return true;
  }

  // ── PAS 4: Roluri din event + rolesCache ──────────────────────────────────
  // member.roles vine din MESSAGE_CREATE si e mereu actualizat (rolul userului azi)
  // rolesCache e populat la GUILD_CREATE — stim permisiunile fiecarui rol
  // Zero API calls. Esueaza doar daca cache e gol (bot offline la adaugare)
  const eventRoles = member?.roles || [];
  if (eventRoles.length) {
    const cachedRoles = rolesCache.get(gId);
    if (cachedRoles?.length) {
      const perms = calcPerms(eventRoles, cachedRoles, gId);
      if (checkBits(String(perms))) return true;
    }
  }

  // ── PAS 5: Roluri din event + getRoles fresh ──────────────────────────────
  // rolesCache era gol — un singur API call pentru rolurile serverului
  // Folosim rolurile din event pentru user (fara getMember)
  // Populeaza cache-ul pentru request-urile urmatoare
  if (eventRoles.length) {
    try {
      const freshRoles = await api.guilds.getRoles(gId);
      const allRoles   = Array.isArray(freshRoles) ? freshRoles : [];
      if (allRoles.length) {
        rolesCache.set(gId, allRoles); // populeaza cache pentru viitor
        const perms = calcPerms(eventRoles, allRoles, gId);
        if (checkBits(String(perms))) return true;
      }
    } catch (_) {}
  }

  // ── PAS 6: getMember fresh + rolesCache sau getRoles ─────────────────────
  // Event nu a trimis member.roles deloc — facem getMember pentru rolurile userului
  // Combinam cu cache (daca exista) sau cu un getRoles fresh (daca nu)
  if (!eventRoles.length) {
    try {
      const freshMember = await api.guilds.getMember(gId, userId);
      const memberRoles = freshMember?.roles || [];
      if (memberRoles.length) {
        let allRoles = rolesCache.get(gId) || [];
        if (!allRoles.length) {
          try {
            const fetched = await api.guilds.getRoles(gId);
            allRoles = Array.isArray(fetched) ? fetched : [];
            if (allRoles.length) rolesCache.set(gId, allRoles);
          } catch (_) {}
        }
        if (allRoles.length) {
          const perms = calcPerms(memberRoles, allRoles, gId);
          if (checkBits(String(perms))) return true;
        }
      }
    } catch (_) {}
  }

  // ── PAS 7: Channel permission_overwrites ──────────────────────────────────
  // Toti pasii anteriori au esuat — Fluxer API nu functioneaza
  // Fluxer trimite permission_overwrites la nivel de canal mai consistent decat guild perms
  // Daca userul sau unul din rolurile sale are un overwrite explicit cu bits privilegiate,
  // e aproape sigur un admin/mod care a primit acces explicit pe acel canal
  try {
    const channel    = await api.channels.get(message.channel_id);
    const overwrites = channel?.permission_overwrites || [];
    const ids        = new Set([...(eventRoles), userId].map(String));
    for (const ow of overwrites) {
      if (!ids.has(String(ow.id))) continue;
      try {
        if (checkBits(String(BigInt(ow.allow || '0')))) return true;
      } catch (_) {}
    }
  } catch (_) {}

  return false;
}

// Verifica daca autorul poate actiona asupra target-ului
// Reguli: nu poti actiona asupra ta insuti, nu poti actiona asupra owner-ului,
// nu poti actiona asupra cuiva cu rol mai mare sau egal cu al tau
async function canTarget(api, guildId, authorMessage, targetId) {
  // Nu poti actiona asupra ta insuti
  if (authorMessage.author.id === targetId) return { ok: false, reason: "You can't use this command on yourself." };

  // Nu poti actiona asupra owner-ului botului
  if (isOwner(targetId)) return { ok: false, reason: "You can't use this command on the bot owner." };

  // Fetch member-ul target
  const targetMember = await api.guilds.getMember(guildId, targetId).catch(() => null);
  if (!targetMember) return { ok: true }; // daca nu e in server (ex: unban), permite

  // Nu poti actiona asupra owner-ului serverului
  const { ownerCache: ownerMap2 } = require('../utils/isPrivileged');
  const ownerId = ownerMap2?.get(String(guildId));
  if (ownerId && String(ownerId) === String(targetId)) {
    return { ok: false, reason: "You can't use this command on the server owner." };
  }

  // Nu poti actiona asupra unui user cu permisiuni privilegiate (admin, ban, kick, etc.)
  const { isPrivileged } = require('../utils/isPrivileged');
  if (await isPrivileged(api, guildId, targetId, targetMember.roles)) {
    return { ok: false, reason: "You can't use this command on someone with administrative permissions." };
  }

  return { ok: true };
}

async function handleMessage(api, message) {
  if (!message.guild_id || message.author?.bot) return;

  const settings = await getSettings(message.guild_id);
  const prefix   = settings?.prefix || process.env.DEFAULT_PREFIX || 'fg!';
  const botId    = '1479261972163135794';

  // Mention handler — raspunde cand e mentionat botul
  const mentionPrefix = `<@${botId}>`;
  const mentionAlt    = `<@!${botId}>`;
  const content       = message.content || '';
  if (content.trim() === mentionPrefix || content.trim() === mentionAlt || content.trim() === `<@${botId}>`) {
    await api.channels.replyMessage(message.channel_id, message.id, {
      embeds: [{
        color: 0x1F3A8E,
        title: "👋  Hey there! I'm FluxGuard.",
        description: "Your server's security and moderation bot, built exclusively for Fluxer.\n\nI'm here to keep your server safe 24/7 — automatically handling spam, raids, nukes, and anything in between.",
        fields: [
          { name: '⚙️ My prefix here', value: `\`${prefix}\``, inline: true },
          { name: '🔧 Change it with', value: `\`${prefix}setprefix <new prefix>\``, inline: true },
          { name: '📖 Get started', value: `\`${prefix}help\` — full command list\n\`${prefix}config\` — view all settings\n\`${prefix}guardian\` — server security score`, inline: false },
          { name: '🌐 Community', value: '[Join our Fluxer server](https://fluxer.gg/0mLkdw2i)', inline: true },
        ],
        footer: { text: 'FluxGuard • Built for Fluxer' },
        timestamp: new Date().toISOString(),
      }]
    }).catch(() => {});
    return;
  }

  if (!content.startsWith(prefix)) return;

  const args    = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmdName = args.shift().toLowerCase();

  // ── DEBUG COMMANDS ────────────────────────────────────────────────────────

  // ── COMENZI NORMALE ───────────────────────────────────────────────────────

  const cmd = commands.get(cmdName);
  if (!cmd) return;

  // Check permisiuni
  if (cmd.permissions && !isOwner(message.author.id)) {
    const allowed = await memberHasPermission(api, message.guild_id, message);
    if (!allowed) {
      await api.channels.replyMessage(message.channel_id, message.id, {
        content: '❌ You need Administrator, Ban Members, Kick Members, or Manage Server to use this command.'
      });
      return;
    }
  }

  if (cmd.ownerOnly && !isOwner(message.author.id)) {
    return; // stealth
  }

  if (cmd.adminOnly && !isOwner(message.author.id)) {
    const { ownerCache: ownerMap3 } = require('../utils/isPrivileged');
    const { rolesCache }            = require('../utils/cache');
    const ownerId      = ownerMap3?.get(String(message.guild_id));
    const isServerOwner = ownerId && String(ownerId) === String(message.author.id);
    let hasAdmin = false;
    try {
      const cached   = rolesCache.get(String(message.guild_id));
      const allRoles = cached?.length
        ? cached
        : (() => { const r = api.guilds.getRoles(message.guild_id).catch(() => []); return r; })();
      const resolved = Array.isArray(allRoles) ? allRoles : await Promise.resolve(allRoles);
      const perms = calcPerms(message.member?.roles || [], Array.isArray(resolved) ? resolved : [], message.guild_id);
      hasAdmin = (perms & 8n) === 8n;
    } catch (_) {}
    if (!isServerOwner && !hasAdmin) {
      await api.channels.replyMessage(message.channel_id, message.id, {
        content: '❌ You need **Administrator** permission to use this command.'
      });
      return;
    }
  }

  let replied = false;

  // Wrapper pe replyMessage si createMessage ca sa stim daca s-a trimis deja ceva
  const trackedApi = new Proxy(api, {
    get(target, prop) {
      if (prop === 'channels') {
        return new Proxy(target.channels, {
          get(ch, method) {
            if (method === 'replyMessage' || method === 'createMessage') {
              return (...args) => {
                replied = true;
                return ch[method](...args);
              };
            }
            return ch[method];
          }
        });
      }
      return target[prop];
    }
  });

  try {
    await cmd.execute({
      api: trackedApi,
      message,
      args,
      guildId:   message.guild_id,
      channelId: message.channel_id,
      author:    message.author,
      canTarget: (targetId) => canTarget(api, message.guild_id, message, targetId),
    });
  } catch (err) {
    console.error(`[CMD ERROR] ${cmdName}:`, err.message);
    // Trimite eroarea doar daca comanda nu a trimis deja un raspuns
    if (!replied) {
      await api.channels.replyMessage(message.channel_id, message.id, {
        content: `❌ Error: ${err.message}`
      }).catch(() => {});
    }
  }
}

module.exports = { handleMessage };
