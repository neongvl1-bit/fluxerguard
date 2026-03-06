const { getSettings, updateSettings, addWhitelist, removeWhitelist, getWhitelist,
        addBlacklist, removeBlacklist, getBlacklist } = require('../utils/db');

function resolveId(i) { return i ? i.replace(/[<@!>]/g, '') : null; }
const reply = (api, channelId, content) =>
  api.channels.createMessage(channelId, typeof content === 'string' ? { content } : content);

// ── SETPREFIX ─────────────────────────────────────────────────────────────────
const setprefix = { name: 'setprefix', names: ['setprefix'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    if (!args[0] || args[0].length > 5) return reply(api, channelId,
      '❌ **Usage:** `!setprefix <prefix>`\n**Example:** `!setprefix ?` or `!setprefix g!`\n_(max 5 characters)_');
    await updateSettings(guildId, { prefix: args[0] });
    return reply(api, channelId, `✅ Prefix changed to \`${args[0]}\``);
  }
};

// ── SETLOG ────────────────────────────────────────────────────────────────────
const setlog = { name: 'setlog', names: ['setlog'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const id = args[0] ? resolveId(args[0]) : channelId;
    await updateSettings(guildId, { log_channel: id });
    return reply(api, channelId, `✅ Log channel set to <#${id}>\n_If no logs appear, make sure the bot has permission to send messages there._`);
  }
};

// ── WHITELIST ─────────────────────────────────────────────────────────────────
const whitelist = { name: 'whitelist', names: ['whitelist', 'wl'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const sub = (args[0] || '').toLowerCase();

    if (!sub) return reply(api, channelId,
      '❌ **Usage:**\n`!whitelist add <@user|ID>` — bypass all security checks\n`!whitelist remove <@user|ID>` — remove from whitelist\n`!whitelist list` — show all whitelisted users');

    if (sub === 'list') {
      const l = await getWhitelist(guildId);
      return reply(api, channelId, l.length
        ? { embeds: [{ color: 0x57f287, title: '✅ Security Whitelist',
            description: l.map(id => `• \`${id}\``).join('\n'),
            footer: { text: 'Whitelisted users bypass all auto-security modules' } }] }
        : '📋 The whitelist is empty.');
    }

    const userId = resolveId(args[1]);
    if (!userId) return reply(api, channelId,
      '❌ **Usage:** `!whitelist add/remove <@user|ID>`\n**Example:** `!whitelist add @User`');

    if (sub === 'add') {
      await addWhitelist(guildId, userId);
      return reply(api, channelId, `✅ \`${userId}\` added to whitelist — they bypass all security checks.`);
    }
    if (sub === 'remove') {
      await removeWhitelist(guildId, userId);
      return reply(api, channelId, `✅ \`${userId}\` removed from whitelist.`);
    }
    return reply(api, channelId,
      '❌ Unknown subcommand.\n**Usage:** `!whitelist add/remove/list`');
  }
};

// ── BLACKLIST ─────────────────────────────────────────────────────────────────
const blacklist = { name: 'blacklist', names: ['blacklist', 'bl'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const sub = (args[0] || '').toLowerCase();

    if (!sub) return reply(api, channelId,
      '❌ **Usage:**\n`!blacklist add <@user|ID>` — auto-ban on join\n`!blacklist remove <@user|ID>` — remove from blacklist\n`!blacklist list` — show all blacklisted users');

    if (sub === 'list') {
      const l = await getBlacklist(guildId);
      return reply(api, channelId, l.length
        ? { embeds: [{ color: 0xed4245, title: '🚫 Security Blacklist',
            description: l.map(id => `• \`${id}\``).join('\n'),
            footer: { text: 'Blacklisted users are auto-banned when they join' } }] }
        : '📋 The blacklist is empty.');
    }

    const userId = resolveId(args[1]);
    if (!userId) return reply(api, channelId,
      '❌ **Usage:** `!blacklist add/remove <@user|ID>`\n**Example:** `!blacklist add 123456789012345678`');

    if (sub === 'add') {
      await addBlacklist(guildId, userId);
      return reply(api, channelId, `🚫 \`${userId}\` added to blacklist — they will be auto-banned on join.`);
    }
    if (sub === 'remove') {
      await removeBlacklist(guildId, userId);
      return reply(api, channelId, `✅ \`${userId}\` removed from blacklist.`);
    }
    return reply(api, channelId,
      '❌ Unknown subcommand.\n**Usage:** `!blacklist add/remove/list`');
  }
};

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG_HELP = `❌ **Usage:** \`!config <module> <key> <value>\`

**Modules & keys:**
\`\`\`
!config antiraid  enabled    true/false
!config antiraid  threshold  5          (joins before trigger)
!config antiraid  action     kick/ban

!config antinuke  enabled    true/false
!config antinuke  threshold  3          (actions before trigger)

!config antispam  enabled    true/false
!config antispam  maxmessages 8
!config antispam  action     timeout/kick/ban

!config antiflood enabled    true/false
!config antiflood duplicates 4
\`\`\``;

const config = { name: 'config', names: ['config', 'settings'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    if (!args[0]) {
      const g = await getSettings(guildId);
      return reply(api, channelId, { embeds: [{ color: 0x5865f2,
        title: '⚙️ FluxerGuard Configuration',
        description: `Prefix: \`${g.prefix}\` | Log: ${g.log_channel ? `<#${g.log_channel}>` : '`not set — use !setlog`'}`,
        fields: [
          { name: '🛡️ AntiRaid',  value: `Enabled: **${g.antiraid_enabled}** | ${g.antiraid_threshold} joins/${g.antiraid_interval/1000}s | action: **${g.antiraid_action}**`, inline: false },
          { name: '💥 AntiNuke',  value: `Enabled: **${g.antinuke_enabled}** | ${g.antinuke_threshold} actions/${g.antinuke_interval/1000}s`, inline: false },
          { name: '⚠️ AntiSpam',  value: `Enabled: **${g.antispam_enabled}** | max ${g.antispam_max_msgs} msgs | action: **${g.antispam_action}**`, inline: false },
          { name: '🌊 AntiFlood', value: `Enabled: **${g.antiflood_enabled}** | ${g.antiflood_duplicates} duplicates`, inline: false },
        ],
        footer: { text: 'Use !config <module> <key> <value> to change settings' } }] });
    }

    const [mod, key, value] = [args[0].toLowerCase(), args[1]?.toLowerCase(), args[2]];

    if (!key || !value) return reply(api, channelId, CONFIG_HELP);

    const toBool = v => ['true', 'yes', 'on', '1', 'enable', 'enabled'].includes(v.toLowerCase());
    const toInt  = (v, mn, mx) => {
      const n = parseInt(v);
      if (isNaN(n) || n < mn || n > mx) throw new Error(`Must be a number between ${mn} and ${mx}`);
      return n;
    };

    try {
      const p = {};
      if (mod === 'antiraid') {
        if (key === 'enabled')   p.antiraid_enabled   = toBool(value);
        else if (key === 'threshold') p.antiraid_threshold = toInt(value, 2, 50);
        else if (key === 'action') {
          if (!['kick','ban'].includes(value)) throw new Error('Action must be `kick` or `ban`');
          p.antiraid_action = value;
        } else throw new Error(`Unknown key \`${key}\` for antiraid`);
      } else if (mod === 'antinuke') {
        if (key === 'enabled')   p.antinuke_enabled   = toBool(value);
        else if (key === 'threshold') p.antinuke_threshold = toInt(value, 1, 20);
        else throw new Error(`Unknown key \`${key}\` for antinuke`);
      } else if (mod === 'antispam') {
        if (key === 'enabled')   p.antispam_enabled   = toBool(value);
        else if (key === 'maxmessages') p.antispam_max_msgs = toInt(value, 3, 50);
        else if (key === 'action') {
          if (!['timeout','kick','ban'].includes(value)) throw new Error('Action must be `timeout`, `kick` or `ban`');
          p.antispam_action = value;
        } else throw new Error(`Unknown key \`${key}\` for antispam`);
      } else if (mod === 'antiflood') {
        if (key === 'enabled')   p.antiflood_enabled   = toBool(value);
        else if (key === 'duplicates') p.antiflood_duplicates = toInt(value, 2, 20);
        else throw new Error(`Unknown key \`${key}\` for antiflood`);
      } else {
        throw new Error(`Unknown module \`${mod}\`. Use: \`antiraid\`, \`antinuke\`, \`antispam\`, \`antiflood\``);
      }
      await updateSettings(guildId, p);
      return reply(api, channelId, `✅ **${mod}.${key}** set to \`${value}\``);
    } catch (err) {
      return reply(api, channelId, `❌ ${err.message}\n\nRun \`!config\` to see all options.`);
    }
  }
};

// ── HELP ──────────────────────────────────────────────────────────────────────
const help = { name: 'help', names: ['help'],
  async execute({ api, guildId, channelId }) {
    const { prefix } = await getSettings(guildId);
    const p = prefix || '!';
    return reply(api, channelId, { embeds: [{ color: 0x5865f2,
      title: '🛡️ FluxerGuard — Commands',
      description: `Current prefix: \`${p}\`  |  Use \`${p}help\` anytime`,
      fields: [
        { name: '🔨 Moderation', value: [
          `\`${p}ban <@user|ID> [reason]\``,
          `\`${p}kick <@user|ID> [reason]\``,
          `\`${p}warn <@user|ID> <reason>\``,
          `\`${p}unban <userID> [reason]\``,
          `\`${p}timeout <@user|ID> <duration> [reason]\``,
          `\`${p}untimeout <@user|ID> [reason]\``,
        ].join('\n') },
        { name: '📋 Cases', value: [
          `\`${p}case <ID>\` — look up a case`,
          `\`${p}case history <@user|ID>\` — user history`,
        ].join('\n') },
        { name: '🛡️ Security', value: [
          `\`${p}config\` — view/edit security settings`,
          `\`${p}whitelist add/remove/list\``,
          `\`${p}blacklist add/remove/list\``,
        ].join('\n') },
        { name: '⚙️ Setup', value: [
          `\`${p}setprefix <prefix>\` — change bot prefix`,
          `\`${p}setlog [#channel]\` — set log channel`,
        ].join('\n') },
        { name: '⏱️ Duration format', value: '`30s` `10m` `2h` `1d` (max 28d)' },
      ],
      footer: { text: 'FluxerGuard • Multi-Server Security Bot' },
      timestamp: new Date().toISOString() }] });
  }
};

module.exports = setprefix;
module.exports.extra = [setlog, whitelist, blacklist, config, help];
