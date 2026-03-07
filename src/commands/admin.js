const { getSettings, updateSettings, addWhitelist, removeWhitelist, getWhitelist,
        addBlacklist, removeBlacklist, getBlacklist } = require('../utils/db');
const E = require('../utils/embeds');

function resolveId(i) { return i ? i.replace(/[<@!>&]/g, '') : null; }
const send = (api, channelId, body) => api.channels.createMessage(channelId,
  typeof body === 'string' ? E.error('Error', body) : body);

// ── SETPREFIX ─────────────────────────────────────────────────────────────────
const setprefix = { name: 'setprefix', names: ['setprefix'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    if (!args[0] || args[0].length > 5) return send(api, channelId,
      E.error('Invalid Prefix', 'Usage: `!setprefix <prefix>`\nExample: `!setprefix ?` or `!setprefix g!`\n*(max 5 characters)*'));
    await updateSettings(guildId, { prefix: args[0] });
    return send(api, channelId, E.success('Prefix Updated', `Bot prefix changed to \`${args[0]}\``));
  }
};

// ── SETLOG ────────────────────────────────────────────────────────────────────
const setlog = { name: 'setlog', names: ['setlog'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const id = args[0] ? resolveId(args[0]) : channelId;
    await updateSettings(guildId, { log_channel: id });
    return send(api, channelId, E.success('Log Channel Updated', `Moderation logs will be sent to <#${id}>`));
  }
};

// ── WHITELIST ─────────────────────────────────────────────────────────────────
const whitelist = { name: 'whitelist', names: ['whitelist', 'wl'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const sub = (args[0] || '').toLowerCase();
    if (!sub) return send(api, channelId,
      E.error('Missing Subcommand', 'Usage:\n`!whitelist add <@user|ID>` — bypass all security\n`!whitelist remove <@user|ID>`\n`!whitelist list`'));
    if (sub === 'list') {
      const l = await getWhitelist(guildId);
      return send(api, channelId, E.listEmbed('whitelist', l));
    }
    const userId = resolveId(args[1]);
    if (!userId) return send(api, channelId,
      E.error('Missing User', 'Usage: `!whitelist add/remove <@user|ID>`'));
    if (sub === 'add') {
      await addWhitelist(guildId, userId);
      return send(api, channelId, E.success('Whitelist Updated', `\`${userId}\` added to the whitelist.\nThey now bypass all auto-security modules.`));
    }
    if (sub === 'remove') {
      await removeWhitelist(guildId, userId);
      return send(api, channelId, E.success('Whitelist Updated', `\`${userId}\` removed from the whitelist.`));
    }
    return send(api, channelId, E.error('Unknown Subcommand', 'Valid subcommands: `add` / `remove` / `list`'));
  }
};

// ── BLACKLIST ─────────────────────────────────────────────────────────────────
const blacklist = { name: 'blacklist', names: ['blacklist', 'bl'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const sub = (args[0] || '').toLowerCase();
    if (!sub) return send(api, channelId,
      E.error('Missing Subcommand', 'Usage:\n`!blacklist add <@user|ID>` — auto-ban on join\n`!blacklist remove <@user|ID>`\n`!blacklist list`'));
    if (sub === 'list') {
      const l = await getBlacklist(guildId);
      return send(api, channelId, E.listEmbed('blacklist', l));
    }
    const userId = resolveId(args[1]);
    if (!userId) return send(api, channelId,
      E.error('Missing User', 'Usage: `!blacklist add/remove <@user|ID>`'));
    if (sub === 'add') {
      await addBlacklist(guildId, userId);
      return send(api, channelId, E.success('Blacklist Updated', `\`${userId}\` added to the blacklist.\nThey will be auto-banned when they join.`));
    }
    if (sub === 'remove') {
      await removeBlacklist(guildId, userId);
      return send(api, channelId, E.success('Blacklist Updated', `\`${userId}\` removed from the blacklist.`));
    }
    return send(api, channelId, E.error('Unknown Subcommand', 'Valid subcommands: `add` / `remove` / `list`'));
  }
};

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG_HELP = E.info('Configuration Help',
  'Usage: `!config <module> <key> <value>`',
  [
    E.field('AntiRaid',  '`enabled` true/false\n`threshold` 2–50\n`action` kick/ban/**alert**',            true),
    E.field('AntiNuke',  '`enabled` true/false\n`threshold` 1–20\n`action` ban/**alert**',                 true),
    E.field('AntiSpam',  '`enabled` true/false\n`maxmessages` 3–50\n`action` timeout/kick/ban/**alert**',  true),
    E.field('AntiFlood', '`enabled` true/false\n`duplicates` 2–20\n*(shares AntiSpam action)*',            true),
    E.field('ℹ️ Alert mode', '`alert` = bot detects the threat but takes **no action** — only sends a warning to the log channel so moderators can decide.', false),
  ]
);

const config = { name: 'config', names: ['config', 'settings'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    if (!args[0]) {
      const g = await getSettings(guildId);
      return send(api, channelId, E.configEmbed(g));
    }

    const [mod, key, value] = [args[0].toLowerCase(), args[1]?.toLowerCase(), args[2]];
    if (!key || !value) return send(api, channelId, CONFIG_HELP);

    const toBool = v => ['true','yes','on','1','enable','enabled'].includes(v.toLowerCase());
    const toInt  = (v, mn, mx) => {
      const n = parseInt(v);
      if (isNaN(n) || n < mn || n > mx) throw new Error(`Must be between ${mn} and ${mx}`);
      return n;
    };

    try {
      const p = {};

      if (mod === 'antiraid') {
        if      (key === 'enabled')   p.antiraid_enabled   = toBool(value);
        else if (key === 'threshold') p.antiraid_threshold = toInt(value, 2, 50);
        else if (key === 'action') {
          if (!['kick','ban','alert'].includes(value)) throw new Error('Action must be `kick`, `ban` or `alert`');
          p.antiraid_action = value;
        } else throw new Error(`Unknown key \`${key}\` for antiraid`);

      } else if (mod === 'antinuke') {
        if      (key === 'enabled')   p.antinuke_enabled   = toBool(value);
        else if (key === 'threshold') p.antinuke_threshold = toInt(value, 1, 20);
        else if (key === 'action') {
          if (!['ban','alert'].includes(value)) throw new Error('Action must be `ban` or `alert`');
          p.antinuke_action = value;
        } else throw new Error(`Unknown key \`${key}\` for antinuke`);

      } else if (mod === 'antispam') {
        if      (key === 'enabled')     p.antispam_enabled   = toBool(value);
        else if (key === 'maxmessages') p.antispam_max_msgs  = toInt(value, 3, 50);
        else if (key === 'action') {
          if (!['timeout','kick','ban','alert'].includes(value)) throw new Error('Action must be `timeout`, `kick`, `ban` or `alert`');
          p.antispam_action = value;
        } else throw new Error(`Unknown key \`${key}\` for antispam`);

      } else if (mod === 'antiflood') {
        if      (key === 'enabled')    p.antiflood_enabled    = toBool(value);
        else if (key === 'duplicates') p.antiflood_duplicates = toInt(value, 2, 20);
        else throw new Error(`Unknown key \`${key}\` for antiflood`);

      } else {
        throw new Error(`Unknown module \`${mod}\`. Valid: \`antiraid\`, \`antinuke\`, \`antispam\`, \`antiflood\``);
      }

      await updateSettings(guildId, p);
      return send(api, channelId, E.success('Configuration Updated', `**${mod}.${key}** → \`${value}\``));
    } catch (err) {
      return send(api, channelId, E.error('Invalid Configuration', `${err.message}\n\nRun \`!config\` to see all options.`));
    }
  }
};

// ── HELP ──────────────────────────────────────────────────────────────────────
const help = { name: 'help', names: ['help'],
  async execute({ api, guildId, channelId }) {
    const { prefix } = await getSettings(guildId);
    return send(api, channelId, E.helpEmbed(prefix));
  }
};

module.exports = setprefix;
module.exports.extra = [setlog, whitelist, blacklist, config, help];
