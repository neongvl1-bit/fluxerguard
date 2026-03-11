require('dotenv').config();
const { getSettings, updateSettings, addWhitelist, removeWhitelist, getWhitelist, isRoleWhitelisted, addWhitelistRole, removeWhitelistRole, getWhitelistRoles, addBlacklist, removeBlacklist, getBlacklist, isRoleBlacklisted, addBlacklistRole, removeBlacklistRole, getBlacklistRoles } = require('../utils/db');
const E = require('../utils/embeds');
const { getBotUser, getGuildRegistry, getBotStartTime, getGatewayPing } = require('../utils/botState');

function resolveId(i) { return i ? i.replace(/[<#@!&>]/g, '') : null; }

const send = (api, channelId, messageId, body) => {
  const payload = typeof body === 'string' ? E.error('Error', body) : { ...body };
  if (messageId) return api.channels.replyMessage(channelId, messageId, payload);
  return api.channels.createMessage(channelId, payload);
};

// ── SETPREFIX ─────────────────────────────────────────────────────────────────
const setprefix = { name: 'setprefix', names: ['setprefix'], permissions: true,
  async execute({ api, args, guildId, channelId, message }) {
    const mid = message?.id;
    const g = await getSettings(guildId);
    const p = args[0];
    if (!p || p.length > 5) return send(api, channelId, mid,
      E.error('Invalid Prefix', `Prefix must be 1–5 characters.\nExample: \`${g.prefix}setprefix ?\``));
    await updateSettings(guildId, { prefix: p });
    return send(api, channelId, mid, E.success('Prefix Updated', `Prefix set to \`${p}\``));
  }
};

// ── SETLOG ────────────────────────────────────────────────────────────────────
const setlog = { name: 'setlog', names: ['setlog'], permissions: true,
  async execute({ api, args, guildId, channelId, message }) {
    const mid = message?.id;
    const g = await getSettings(guildId);
    if (!args[0]) {
      await updateSettings(guildId, { log_channel: null });
      return send(api, channelId, mid, E.success('Log Disabled', 'Log channel has been removed.'));
    }
    const id = resolveId(args[0]);
    if (!id) return send(api, channelId, mid, E.error('Invalid Channel', `Usage: \`${g.prefix}setlog #channel\` or \`${g.prefix}setlog\` to disable.`));
    await updateSettings(guildId, { log_channel: id });
    return send(api, channelId, mid, E.success('Log Channel Set', `Logging to <#${id}>`));
  }
};

// ── WHITELIST ─────────────────────────────────────────────────────────────────
// Detecteaza tipul argumentului: mentiune rol, mentiune user, sau ID numeric
function parseTarget(raw) {
  if (!raw) return null;
  if (/^<@&\d+>$/.test(raw)) return { type: 'role', id: raw.replace(/\D/g, '') };
  if (/^<@!?\d+>$/.test(raw)) return { type: 'user', id: raw.replace(/[<@!>]/g, '') };
  if (/^\d{10,20}$/.test(raw)) return { type: 'user', id: raw };
  return { type: 'invalid', id: null };
}

const whitelist = { name: 'whitelist', names: ['whitelist', 'wl'], permissions: true,
  async execute({ api, args, guildId, channelId, message }) {
    const mid = message?.id;
    const sub = (args[0] || '').toLowerCase();
    const g = await getSettings(guildId);
    const p = g.prefix || 'fg!';
    const usage = `Usage: \`${p}whitelist add/remove/list <@user|ID|@role>\``;

    if (sub === 'add') {
      const target = parseTarget(args[1]);
      if (!target) return send(api, channelId, mid, E.error('Missing Target', usage));
      if (target.type === 'invalid') return send(api, channelId, mid, E.error('Invalid Input', 'Please use a **user mention**, **user ID**, or **role mention** (`@Role`).'));
      if (target.type === 'role') {
        await addWhitelistRole(guildId, target.id);
        return send(api, channelId, mid, E.success('Role Whitelisted', `<@&${target.id}> — all members with this role will bypass auto-security modules.`));
      }
      await addWhitelist(guildId, target.id);
      return send(api, channelId, mid, E.success('User Whitelisted', `<@${target.id}> will bypass all auto-security modules.`));
    }
    if (sub === 'remove') {
      const target = parseTarget(args[1]);
      if (!target) return send(api, channelId, mid, E.error('Missing Target', usage));
      if (target.type === 'invalid') return send(api, channelId, mid, E.error('Invalid Input', 'Please use a **user mention**, **user ID**, or **role mention** (`@Role`).'));
      if (target.type === 'role') {
        await removeWhitelistRole(guildId, target.id);
        return send(api, channelId, mid, E.success('Removed', `<@&${target.id}> removed from whitelist.`));
      }
      await removeWhitelist(guildId, target.id);
      return send(api, channelId, mid, E.success('Removed', `<@${target.id}> removed from whitelist.`));
    }
    if (sub === 'list') {
      const [userIds, roleIds] = await Promise.all([getWhitelist(guildId), getWhitelistRoles(guildId)]);
      const fields = [];
      if (userIds.length)  fields.push({ name: `👤 Users (${userIds.length})`,  value: userIds.map(id => `<@${id}>`).join(' '),   inline: false });
      if (roleIds.length)  fields.push({ name: `🎭 Roles (${roleIds.length})`,  value: roleIds.map(id => `<@&${id}>`).join(' '),  inline: false });
      if (!fields.length)  fields.push({ name: 'Empty', value: 'No users or roles whitelisted.', inline: false });
      return send(api, channelId, mid, { embeds: [{ color: 0x2E86DE, title: '📋  Whitelist', fields }] });
    }
    return send(api, channelId, mid, E.error('Usage', usage));
  }
};

// ── BLACKLIST ─────────────────────────────────────────────────────────────────
const blacklist = { name: 'blacklist', names: ['blacklist', 'bl'], permissions: true,
  async execute({ api, args, guildId, channelId, message }) {
    const mid = message?.id;
    const sub = (args[0] || '').toLowerCase();
    const g = await getSettings(guildId);
    const p = g.prefix || 'fg!';
    const usage = `Usage: \`${p}blacklist add/remove/list <@user|ID|@role>\``;

    if (sub === 'add') {
      const target = parseTarget(args[1]);
      if (!target) return send(api, channelId, mid, E.error('Missing Target', usage));
      if (target.type === 'invalid') return send(api, channelId, mid, E.error('Invalid Input', 'Please use a **user mention**, **user ID**, or **role mention** (`@Role`).'));
      if (target.type === 'role') {
        await addBlacklistRole(guildId, target.id);
        return send(api, channelId, mid, E.success('Role Blacklisted', `<@&${target.id}> — any member with this role will be auto-banned on join.`));
      }
      await addBlacklist(guildId, target.id);
      return send(api, channelId, mid, E.success('Blacklisted', `<@${target.id}> will be auto-banned on join.`));
    }
    if (sub === 'remove') {
      const target = parseTarget(args[1]);
      if (!target) return send(api, channelId, mid, E.error('Missing Target', usage));
      if (target.type === 'invalid') return send(api, channelId, mid, E.error('Invalid Input', 'Please use a **user mention**, **user ID**, or **role mention** (`@Role`).'));
      if (target.type === 'role') {
        await removeBlacklistRole(guildId, target.id);
        return send(api, channelId, mid, E.success('Removed', `<@&${target.id}> removed from blacklist.`));
      }
      await removeBlacklist(guildId, target.id);
      return send(api, channelId, mid, E.success('Removed', `<@${target.id}> removed from blacklist.`));
    }
    if (sub === 'list') {
      const [userIds, roleIds] = await Promise.all([getBlacklist(guildId), getBlacklistRoles(guildId)]);
      const fields = [];
      if (userIds.length)  fields.push({ name: `👤 Users (${userIds.length})`,  value: userIds.map(id => `<@${id}>`).join(' '),   inline: false });
      if (roleIds.length)  fields.push({ name: `🎭 Roles (${roleIds.length})`,  value: roleIds.map(id => `<@&${id}>`).join(' '),  inline: false });
      if (!fields.length)  fields.push({ name: 'Empty', value: 'No users or roles blacklisted.', inline: false });
      return send(api, channelId, mid, { embeds: [{ color: 0xE74C3C, title: '🚫  Blacklist', fields }] });
    }
    return send(api, channelId, mid, E.error('Usage', usage));
  }
};

// ── CONFIG ────────────────────────────────────────────────────────────────────
const config = { name: 'config', names: ['config', 'settings'], permissions: true,
  async execute({ api, args, guildId, channelId, message }) {
    const mid = message?.id;
    const g = await getSettings(guildId);
    if (!args[0]) return send(api, channelId, mid, E.configEmbed(g));
    const [module, key, ...rest] = args;
    const value = rest.join(' ');
    const mod  = module.toLowerCase();
    const k    = key ? key.toLowerCase() : null;
    const v    = value.toLowerCase();
    const numVal  = parseInt(value);
    const boolVal = ['true','on','enable','enabled'].includes(v);
    const falseV  = ['false','off','disable','disabled'].includes(v);
    const validActions = ['ban', 'kick', 'timeout', 'alert'];
    const modules = ['antiraid', 'antinuke', 'antispam', 'antiflood'];

    // Shortcut: fg!config <module> enable / disable
    if (modules.includes(mod) && ['enable','disable','on','off'].includes(k)) {
      const isEnable = ['enable','on'].includes(k);
      const patchMap = {
        antiraid:  { antiraid_enabled:  isEnable },
        antinuke:  { antinuke_enabled:  isEnable },
        antispam:  { antispam_enabled:  isEnable },
        antiflood: { antiflood_enabled: isEnable },
      };
      await updateSettings(guildId, patchMap[mod]);
      const moduleName = { antiraid: '🛡️ AntiRaid', antinuke: '💥 AntiNuke', antispam: '⚠️ AntiSpam', antiflood: '🌊 AntiFlood' }[mod];
      return send(api, channelId, mid, {
        embeds: [{ color: isEnable ? 0x43B581 : 0xE74C3C, description: `${moduleName} has been **${isEnable ? 'enabled' : 'disabled'}**.` }]
      });
    }

    // Determina ce se schimba si aplica
    let patch = null;
    let displayKey = null;
    let displayVal = null;

    if (mod === 'antiraid') {
      if (k === 'threshold' && numVal > 0)               { patch = { antiraid_threshold: numVal };             displayKey = 'Threshold';  displayVal = `${numVal} joins`; }
      else if (k === 'interval'  && numVal > 0)          { patch = { antiraid_interval: numVal * 1000 };       displayKey = 'Interval';   displayVal = `${numVal}s`; }
      else if (k === 'action' && validActions.includes(v)) { patch = { antiraid_action: v };                   displayKey = 'Action';     displayVal = v; }
      else return send(api, channelId, mid, E.error('Invalid', `Keys: \`threshold\`, \`interval\`, \`action\`\nActions: \`ban\`, \`kick\`, \`alert\`\nTo toggle: \`${g.prefix || 'fg!'}config antiraid enable/disable\``));
    } else if (mod === 'antinuke') {
      if (k === 'threshold' && numVal > 0)               { patch = { antinuke_threshold: numVal };             displayKey = 'Threshold';  displayVal = `${numVal} actions`; }
      else if (k === 'interval'  && numVal > 0)          { patch = { antinuke_interval: numVal * 1000 };       displayKey = 'Interval';   displayVal = `${numVal}s`; }
      else if (k === 'action' && ['ban','alert'].includes(v)) { patch = { antinuke_action: v };                displayKey = 'Action';     displayVal = v; }
      else return send(api, channelId, mid, E.error('Invalid', `Keys: \`threshold\`, \`interval\`, \`action\`\nActions: \`ban\`, \`alert\`\nTo toggle: \`${g.prefix || 'fg!'}config antinuke enable/disable\``));
    } else if (mod === 'antispam') {
      if (k === 'max'      && numVal > 0)                { patch = { antispam_max_msgs: numVal };              displayKey = 'Max Msgs';   displayVal = `${numVal} messages`; }
      else if (k === 'interval' && numVal > 0)           { patch = { antispam_interval: numVal * 1000 };       displayKey = 'Interval';   displayVal = `${numVal}s`; }
      else if (k === 'action' && validActions.includes(v)) { patch = { antispam_action: v };                   displayKey = 'Action';     displayVal = v; }
      else if (k === 'publicmsg' && ['enable','disable','on','off'].includes(v)) {
        const isOn = v === 'enable' || v === 'on';
        patch = { antispam_public_msg: isOn };
        displayKey = 'Public Message'; displayVal = isOn ? '✅ Enabled' : '❌ Disabled';
      }
      else return send(api, channelId, mid, E.error('Invalid', `Keys: \`max\`, \`interval\`, \`action\`, \`publicmsg\`\nActions: \`ban\`, \`kick\`, \`timeout\`, \`alert\`\nTo toggle: \`${g.prefix || 'fg!'}config antispam enable/disable\``));
    } else if (mod === 'antiflood') {
      if (k === 'duplicates' && numVal > 0)              { patch = { antiflood_duplicates: numVal };           displayKey = 'Duplicates'; displayVal = `${numVal} identical msgs`; }
      else return send(api, channelId, mid, E.error('Invalid', `Keys: \`duplicates\`\nTo toggle: \`${g.prefix || 'fg!'}config antiflood enable/disable\``));
    } else {
      return send(api, channelId, mid, E.error('Unknown Module', 'Modules: `antiraid`, `antinuke`, `antispam`, `antiflood`'));
    }

    // Aplica setarea
    try {
      await updateSettings(guildId, patch);
      const moduleName = { antiraid: '🛡️ AntiRaid', antinuke: '💥 AntiNuke', antispam: '⚠️ AntiSpam', antiflood: '🌊 AntiFlood' }[mod];
      return send(api, channelId, mid, {
        embeds: [{
          color: 0x43B581,
          title: '✅ Setting Updated',
          description: `**${moduleName}** → **${displayKey}** has been set to **${displayVal}**.`,
          footer: { text: 'FluxGuard • Use !config to view all settings' },
          timestamp: new Date().toISOString(),
        }]
      });
    } catch (err) {
      console.error('[CONFIG ERROR]', err.message);
      return send(api, channelId, mid, E.error('Update Failed', `Could not save the setting. Please try again.\n-# Error: ${err.message}`));
    }
  }
};

// ── HELP ──────────────────────────────────────────────────────────────────────
const help = { name: 'help', names: ['help'],
  async execute(ctx) {
    const api       = ctx.api;
    const guildId   = ctx.guildId;
    const channelId = ctx.channelId;
    const mid       = ctx.message?.id;
    const { prefix } = await getSettings(guildId);
    let category = null;
    if (ctx.message && ctx.message.content) {
      const parts = ctx.message.content.trim().split(/\s+/);
      if (parts.length >= 2) category = parts[1].toLowerCase();
    }
    const payload = E.helpEmbed(prefix, category);
    if (mid) return api.channels.replyMessage(channelId, mid, payload);
    return api.channels.createMessage(channelId, payload);
  }
};



// ── PING ─────────────────────────────────────────────────────────────────────
const ping = { name: 'ping', names: ['ping'], permissions: false,
  async execute({ api, channelId, message }) {
    const gateway = getGatewayPing();
    const before  = Date.now();
    const sent    = await api.channels.createMessage(channelId, { content: '🏓 measuring...' }).catch(() => null);
    const roundtrip = Date.now() - before;

    const desc = [
      '**Roundtrip** — time to send a message to Fluxer and get a response',
      '`' + roundtrip + 'ms`',
      '',
      '**Gateway** — latency between bot and Fluxer WebSocket (last heartbeat)',
      '`' + (gateway >= 0 ? gateway + 'ms' : 'measuring...') + '`',
    ].join('\n');

    await send(api, channelId, message?.id, E.info('🏓 Pong!', desc));
    if (sent?.id) api.channels.deleteMessage(channelId, sent.id).catch(() => {});
  }
};

// ── BOTINFO ───────────────────────────────────────────────────────────────────
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

const botinfo = { name: 'botinfo', names: ['botinfo', 'info'], permissions: false,
  async execute({ api, channelId, message }) {
    const mid     = message?.id;
    const bot     = getBotUser();
    const reg     = getGuildRegistry();
    const uptime  = formatUptime(Date.now() - getBotStartTime());
    const gateway = getGatewayPing();
    const version = require('../../package.json').version || '1.0.0';

    // Conta membri totali din registry
    let totalMembers = 0;
    for (const g of reg.values()) totalMembers += (g.memberCount || 0);

    const embed = {
      embeds: [{
        color: 0x00c8ff,
        title: '🛡️  FluxGuard',
        description: 'A powerful security & moderation bot for Fluxer.',
        fields: [
          { name: '🤖 Bot',        value: '<@1479261972163135794>',               inline: true },
          { name: '📦 Version',    value: `v${version}`,                           inline: true },
          { name: '⏱️ Uptime',     value: uptime,                                  inline: true },
          { name: '🌐 Servers',    value: String(reg.size),                        inline: true },
          { name: '👥 Users',      value: totalMembers.toLocaleString(),           inline: true },
          { name: '📡 Gateway',    value: gateway >= 0 ? `${gateway}ms` : 'measuring...', inline: true },
        ],
        footer: { text: 'FluxGuard • fluxer.gg/0mLkdw2i' },
        timestamp: new Date().toISOString(),
      }],
    };
    await send(api, channelId, mid, embed);
  }
};

module.exports = setprefix;
module.exports.extra = [setlog, whitelist, blacklist, config, help];

// ── SERVERS (owner only) ──────────────────────────────────────────────────────
const servers = { name: 'servers', names: ['servers', 'serverlist'], ownerOnly: true,
  async execute({ api, channelId, author, message }) {
    const mid = message?.id;
    const { getGuildRegistry } = require('../index');
    const registry = getGuildRegistry();

    // Daca registry e gol, incearca fetch direct de la API
    let guilds = registry && registry.size > 0 ? [...registry.values()] : [];

    if (guilds.length === 0) {
      try {
        const fetched = await api.users.getGuilds();
        const list = Array.isArray(fetched) ? fetched : [];
        // Fetch detalii complete pentru fiecare guild
        const details = await Promise.allSettled(list.map(g => api.guilds.get(g.id)));
        for (const r of details) {
          if (r.status === 'fulfilled' && r.value?.id) {
            const g = r.value;
            guilds.push({
              id:          String(g.id),
              name:        g.name || 'Unknown',
              ownerId:     String(g.owner_id || 'Unknown'),
              memberCount: g.member_count || g.approximate_member_count || 0,
            });
            // Salveaza si in registry pentru viitor
            registry.set(String(g.id), guilds[guilds.length - 1]);
          }
        }
      } catch (e) {
        console.error('[SERVERS]', e.message);
      }
    }

    if (guilds.length === 0) {
      return send(api, channelId, mid,
        E.error('No Data', 'Could not retrieve server list. The bot may not be in any servers yet.'));
    }

    // Fetch owner usernames in parallel
    const ownerNames = await Promise.allSettled(
      guilds.map(g => api.users.get(g.ownerId).catch(() => null))
    );

    const lines = guilds.map((g, i) => {
      const ownerUser = ownerNames[i].status === 'fulfilled' ? ownerNames[i].value : null;
      const ownerTag  = ownerUser?.username ? `${ownerUser.username}` : `\`${g.ownerId}\``;
      const members   = g.memberCount ? ` • ${g.memberCount} members` : '';
      return `**${g.name}**${members}\n┗ Owner: ${ownerTag} • ID: \`${g.id}\``;
    });

    // Split in chunks of 10 servere per embed
    const CHUNK = 10;
    const chunks = [];
    for (let i = 0; i < lines.length; i += CHUNK) {
      chunks.push(lines.slice(i, i + CHUNK));
    }

    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      const payload = {
        embeds: [{
          color: 0x0099CC,
          title: isFirst ? `🌐  FluxGuard — Server List (${guilds.length} total)` : `🌐  Server List (continued)`,
          description: chunks[i].join('\n\n'),
          footer: { text: `FluxGuard  •  Page ${i + 1}/${chunks.length}` },
        }],
      };
      await api.channels.createMessage(channelId, payload).catch(() => {});
    }
  }
};

// ── ALERTROLE ─────────────────────────────────────────────────────────────────
const alertrole = { name: 'alertrole', names: ['alertrole'], permissions: true,
  async execute({ api, args, guildId, channelId, message }) {
    const mid = message?.id;
    const sub = (args[0] || '').toLowerCase();
    const g   = await getSettings(guildId);
    const roles = Array.isArray(g.alert_roles) ? g.alert_roles : [];

    if (sub === 'on') {
      await updateSettings(guildId, { alert_ping_enabled: true });
      return send(api, channelId, mid, {
        embeds: [{ color: 0x2ECC71, title: '🔔  Alert Ping — Enabled',
          description: `Alert role pings are now **enabled**. Configured roles will be pinged whenever a module fires in alert mode.

${roles.length ? roles.map(r => `<@&${r}>`).join(' ') : '*No roles configured yet — use `!alertrole add @role`*'}` }]
      });
    }

    if (sub === 'off') {
      await updateSettings(guildId, { alert_ping_enabled: false });
      return send(api, channelId, mid, {
        embeds: [{ color: 0xE74C3C, title: '🔕  Alert Ping — Disabled',
          description: 'Alert role pings are now **disabled**. Modules will still log to the log channel, but no roles will be pinged.' }]
      });
    }

    if (sub === 'add') {
      // Accepta doar mentiuni valide de rol: <@&ID>
      const newRoles = args.slice(1).filter(a => /^<@&\d+>$/.test(a)).map(a => a.replace(/[<@&>]/g, ''));
      if (!newRoles.length) return send(api, channelId, mid,
        { embeds: [{ color: 0xE74C3C, title: '❌ Invalid Input', description: 'You must mention at least one valid role.\nUsage: `!alertrole add @role1 @role2`' }] });
      const updated = [...new Set([...roles, ...newRoles])];
      await updateSettings(guildId, { alert_roles: updated });
      return send(api, channelId, mid, {
        embeds: [{ color: 0x2ECC71, title: '✅  Alert Roles Updated',
          description: `Added **${newRoles.length}** role(s) to the alert ping list.

**Current roles:** ${updated.map(r => `<@&${r}>`).join(' ')}`,
          footer: { text: `${updated.length} role(s) total` } }]
      });
    }

    if (sub === 'remove') {
      // Accepta doar mentiuni valide de rol: <@&ID>
      const toRemove = args.slice(1).filter(a => /^<@&\d+>$/.test(a)).map(a => a.replace(/[<@&>]/g, ''));
      if (!toRemove.length) return send(api, channelId, mid,
        { embeds: [{ color: 0xE74C3C, title: '❌ Invalid Input', description: 'You must mention at least one valid role.\nUsage: `!alertrole remove @role1 @role2`' }] });
      const updated = roles.filter(r => !toRemove.includes(r));
      await updateSettings(guildId, { alert_roles: updated });
      return send(api, channelId, mid, {
        embeds: [{ color: 0xF1C40F, title: '🗑️  Alert Roles Updated',
          description: `Removed **${toRemove.length}** role(s) from the alert ping list.

${updated.length ? `**Current roles:** ${updated.map(r => `<@&${r}>`).join(' ')}` : '*No roles remaining.*'}`,
          footer: { text: `${updated.length} role(s) remaining` } }]
      });
    }

    // Default — afiseaza status
    const pingEnabled = g.alert_ping_enabled !== false;
    return send(api, channelId, mid, {
      embeds: [{ color: 0x00c8ff, title: '🔔  Alert Role Configuration',
        description: `Manage which roles get pinged when a module fires in **alert mode**.`,
        fields: [
          { name: '📡 Status',       value: pingEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: '👥 Roles',        value: roles.length ? roles.map(r => `<@&${r}>`).join(' ') : '*None configured*', inline: true },
          { name: '📋 Commands',
            value: '`!alertrole add @role` — add a role\n`!alertrole remove @role` — remove a role\n`!alertrole on` — enable pings\n`!alertrole off` — disable pings',
            inline: false },
        ],
        footer: { text: 'Roles are pinged in the log channel when a module is set to alert mode' } }]
    });
  }
};

module.exports.extra.push(servers);
module.exports.extra.push(botinfo);
module.exports.extra.push(ping);
module.exports.extra.push(alertrole);
