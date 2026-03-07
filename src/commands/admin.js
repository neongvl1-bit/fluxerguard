require('dotenv').config();
const { getSettings, updateSettings, addWhitelist, removeWhitelist, getWhitelist, addBlacklist, removeBlacklist, getBlacklist } = require('../utils/db');
const E = require('../utils/embeds');

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
    const p = args[0];
    if (!p || p.length > 5) return send(api, channelId, mid,
      E.error('Invalid Prefix', 'Prefix must be 1–5 characters.\nExample: `!setprefix ?`'));
    await updateSettings(guildId, { prefix: p });
    return send(api, channelId, mid, E.success('Prefix Updated', `Prefix set to \`${p}\``));
  }
};

// ── SETLOG ────────────────────────────────────────────────────────────────────
const setlog = { name: 'setlog', names: ['setlog'], permissions: true,
  async execute({ api, args, guildId, channelId, message }) {
    const mid = message?.id;
    if (!args[0]) {
      await updateSettings(guildId, { log_channel: null });
      return send(api, channelId, mid, E.success('Log Disabled', 'Log channel has been removed.'));
    }
    const id = resolveId(args[0]);
    if (!id) return send(api, channelId, mid, E.error('Invalid Channel', 'Usage: `!setlog #channel` or `!setlog` to disable.'));
    await updateSettings(guildId, { log_channel: id });
    return send(api, channelId, mid, E.success('Log Channel Set', `Logging to <#${id}>`));
  }
};

// ── WHITELIST ─────────────────────────────────────────────────────────────────
const whitelist = { name: 'whitelist', names: ['whitelist', 'wl'], permissions: true,
  async execute({ api, args, guildId, channelId, message }) {
    const mid = message?.id;
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'add') {
      const id = resolveId(args[1]);
      if (!id) return send(api, channelId, mid, E.error('Missing User', 'Usage: `!whitelist add <@user|ID>`'));
      await addWhitelist(guildId, id);
      return send(api, channelId, mid, E.success('Whitelisted', `<@${id}> will bypass all auto-security modules.`));
    }
    if (sub === 'remove') {
      const id = resolveId(args[1]);
      if (!id) return send(api, channelId, mid, E.error('Missing User', 'Usage: `!whitelist remove <@user|ID>`'));
      await removeWhitelist(guildId, id);
      return send(api, channelId, mid, E.success('Removed', `<@${id}> removed from whitelist.`));
    }
    if (sub === 'list') {
      const ids = await getWhitelist(guildId);
      return send(api, channelId, mid, E.listEmbed('whitelist', ids));
    }
    return send(api, channelId, mid, E.error('Usage', '`!whitelist add/remove/list <@user|ID>`'));
  }
};

// ── BLACKLIST ─────────────────────────────────────────────────────────────────
const blacklist = { name: 'blacklist', names: ['blacklist', 'bl'], permissions: true,
  async execute({ api, args, guildId, channelId, message }) {
    const mid = message?.id;
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'add') {
      const id = resolveId(args[1]);
      if (!id) return send(api, channelId, mid, E.error('Missing User', 'Usage: `!blacklist add <@user|ID>`'));
      await addBlacklist(guildId, id);
      return send(api, channelId, mid, E.success('Blacklisted', `<@${id}> will be auto-banned on join.`));
    }
    if (sub === 'remove') {
      const id = resolveId(args[1]);
      if (!id) return send(api, channelId, mid, E.error('Missing User', 'Usage: `!blacklist remove <@user|ID>`'));
      await removeBlacklist(guildId, id);
      return send(api, channelId, mid, E.success('Removed', `<@${id}> removed from blacklist.`));
    }
    if (sub === 'list') {
      const ids = await getBlacklist(guildId);
      return send(api, channelId, mid, E.listEmbed('blacklist', ids));
    }
    return send(api, channelId, mid, E.error('Usage', '`!blacklist add/remove/list <@user|ID>`'));
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

    if (mod === 'antiraid') {
      if (k === 'enabled')                          await updateSettings(guildId, { antiraid_enabled: boolVal || !falseV });
      else if (k === 'threshold' && numVal > 0)     await updateSettings(guildId, { antiraid_threshold: numVal });
      else if (k === 'interval'  && numVal > 0)     await updateSettings(guildId, { antiraid_interval: numVal * 1000 });
      else if (k === 'action' && validActions.includes(v)) await updateSettings(guildId, { antiraid_action: v });
      else return send(api, channelId, mid, E.error('Invalid', 'Keys: `enabled`, `threshold`, `interval`, `action`\nActions: `ban`, `kick`, `alert`'));
    } else if (mod === 'antinuke') {
      if (k === 'enabled')                          await updateSettings(guildId, { antinuke_enabled: boolVal || !falseV });
      else if (k === 'threshold' && numVal > 0)     await updateSettings(guildId, { antinuke_threshold: numVal });
      else if (k === 'interval'  && numVal > 0)     await updateSettings(guildId, { antinuke_interval: numVal * 1000 });
      else if (k === 'action' && ['ban','alert'].includes(v)) await updateSettings(guildId, { antinuke_action: v });
      else return send(api, channelId, mid, E.error('Invalid', 'Keys: `enabled`, `threshold`, `interval`, `action`\nActions: `ban`, `alert`'));
    } else if (mod === 'antispam') {
      if (k === 'enabled')                          await updateSettings(guildId, { antispam_enabled: boolVal || !falseV });
      else if (k === 'max'      && numVal > 0)      await updateSettings(guildId, { antispam_max_msgs: numVal });
      else if (k === 'interval' && numVal > 0)      await updateSettings(guildId, { antispam_interval: numVal * 1000 });
      else if (k === 'action' && validActions.includes(v)) await updateSettings(guildId, { antispam_action: v });
      else return send(api, channelId, mid, E.error('Invalid', 'Keys: `enabled`, `max`, `interval`, `action`\nActions: `ban`, `kick`, `timeout`, `alert`'));
    } else if (mod === 'antiflood') {
      if (k === 'enabled')                          await updateSettings(guildId, { antiflood_enabled: boolVal || !falseV });
      else if (k === 'duplicates' && numVal > 0)    await updateSettings(guildId, { antiflood_duplicates: numVal });
      else return send(api, channelId, mid, E.error('Invalid', 'Keys: `enabled`, `duplicates`'));
    } else {
      return send(api, channelId, mid, E.error('Unknown Module', 'Modules: `antiraid`, `antinuke`, `antispam`, `antiflood`'));
    }

    const updated = await getSettings(guildId);
    return send(api, channelId, mid, E.configEmbed(updated));
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

module.exports = setprefix;
module.exports.extra = [setlog, whitelist, blacklist, config, help];
