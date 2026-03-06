const { getSettings, updateSettings, addWhitelist, removeWhitelist, getWhitelist,
        addBlacklist, removeBlacklist, getBlacklist } = require('../utils/db');

function resolveId(i) { return i ? i.replace(/[<@!>&]/g, '') : null; }
const reply = (api, channelId, content) =>
  api.channels.createMessage(channelId, typeof content === 'string' ? { content } : content);

const setprefix = { name: 'setprefix', names: ['setprefix'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    if (!args[0] || args[0].length > 5) return reply(api, channelId,
      '❌ **Usage:** `!setprefix <prefix>`\n**Example:** `!setprefix ?` or `!setprefix g!`\n_(max 5 characters)_');
    await updateSettings(guildId, { prefix: args[0] });
    return reply(api, channelId, `✅ Prefix changed to \`${args[0]}\``);
  }
};

const setlog = { name: 'setlog', names: ['setlog'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const id = args[0] ? resolveId(args[0]) : channelId;
    await updateSettings(guildId, { log_channel: id });
    return reply(api, channelId, `✅ Log channel set to <#${id}>`);
  }
};

const whitelist = { name: 'whitelist', names: ['whitelist', 'wl'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const sub = (args[0] || '').toLowerCase();
    if (!sub) return reply(api, channelId,
      '❌ **Usage:**\n`!whitelist add <@user|ID>` — bypass all security\n`!whitelist remove <@user|ID>`\n`!whitelist list`');
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
    if (sub === 'add') { await addWhitelist(guildId, userId); return reply(api, channelId, `✅ \`${userId}\` added to whitelist.`); }
    if (sub === 'remove') { await removeWhitelist(guildId, userId); return reply(api, channelId, `✅ \`${userId}\` removed from whitelist.`); }
    return reply(api, channelId, '❌ Unknown subcommand.\n**Usage:** `!whitelist add/remove/list`');
  }
};

const blacklist = { name: 'blacklist', names: ['blacklist', 'bl'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const sub = (args[0] || '').toLowerCase();
    if (!sub) return reply(api, channelId,
      '❌ **Usage:**\n`!blacklist add <@user|ID>` — auto-ban on join\n`!blacklist remove <@user|ID>`\n`!blacklist list`');
    if (sub === 'list') {
      const l = await getBlacklist(guildId);
      return reply(api, channelId, l.length
        ? { embeds: [{ color: 0xed4245, title: '🚫 Security Blacklist',
            description: l.map(id => `• \`${id}\``).join('\n'),
            footer: { text: 'Blacklisted users are auto-banned on join' } }] }
        : '📋 The blacklist is empty.');
    }
    const userId = resolveId(args[1]);
    if (!userId) return reply(api, channelId,
      '❌ **Usage:** `!blacklist add/remove <@user|ID>`\n**Example:** `!blacklist add 123456789012345678`');
    if (sub === 'add') { await addBlacklist(guildId, userId); return reply(api, channelId, `🚫 \`${userId}\` added to blacklist — auto-banned on join.`); }
    if (sub === 'remove') { await removeBlacklist(guildId, userId); return reply(api, channelId, `✅ \`${userId}\` removed from blacklist.`); }
    return reply(api, channelId, '❌ Unknown subcommand.\n**Usage:** `!blacklist add/remove/list`');
  }
};

const CONFIG_HELP = `❌ **Usage:** \`!config <module> <key> <value>\`
\`\`\`
!config antiraid  enabled    true/false
!config antiraid  threshold  5           (joins before trigger)
!config antiraid  action     kick/ban

!config antinuke  enabled    true/false
!config antinuke  threshold  3

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
          { name: '🛡️ AntiRaid',  value: `Enabled: **${g.antiraid_enabled}** | ${g.antiraid_threshold} joins/${g.antiraid_interval/1000}s | action: **${g.antiraid_action}**` },
          { name: '💥 AntiNuke',  value: `Enabled: **${g.antinuke_enabled}** | ${g.antinuke_threshold} actions/${g.antinuke_interval/1000}s` },
          { name: '⚠️ AntiSpam',  value: `Enabled: **${g.antispam_enabled}** | max ${g.antispam_max_msgs} msgs | action: **${g.antispam_action}**` },
          { name: '🌊 AntiFlood', value: `Enabled: **${g.antiflood_enabled}** | ${g.antiflood_duplicates} duplicates` },
        ],
        footer: { text: 'Use !config <module> <key> <value> to change settings' } }] });
    }
    const [mod, key, value] = [args[0].toLowerCase(), args[1]?.toLowerCase(), args[2]];
    if (!key || !value) return reply(api, channelId, CONFIG_HELP);
    const toBool = v => ['true','yes','on','1','enable','enabled'].includes(v.toLowerCase());
    const toInt  = (v, mn, mx) => { const n = parseInt(v); if (isNaN(n)||n<mn||n>mx) throw new Error(`Must be ${mn}–${mx}`); return n; };
    try {
      const p = {};
      if      (mod==='antiraid')  { if(key==='enabled') p.antiraid_enabled=toBool(value); else if(key==='threshold') p.antiraid_threshold=toInt(value,2,50); else if(key==='action'){if(!['kick','ban'].includes(value))throw new Error('Must be `kick` or `ban`');p.antiraid_action=value;}else throw new Error(`Unknown key \`${key}\``); }
      else if (mod==='antinuke')  { if(key==='enabled') p.antinuke_enabled=toBool(value); else if(key==='threshold') p.antinuke_threshold=toInt(value,1,20); else throw new Error(`Unknown key \`${key}\``); }
      else if (mod==='antispam')  { if(key==='enabled') p.antispam_enabled=toBool(value); else if(key==='maxmessages') p.antispam_max_msgs=toInt(value,3,50); else if(key==='action'){if(!['timeout','kick','ban'].includes(value))throw new Error('Must be `timeout`, `kick` or `ban`');p.antispam_action=value;}else throw new Error(`Unknown key \`${key}\``); }
      else if (mod==='antiflood') { if(key==='enabled') p.antiflood_enabled=toBool(value); else if(key==='duplicates') p.antiflood_duplicates=toInt(value,2,20); else throw new Error(`Unknown key \`${key}\``); }
      else throw new Error(`Unknown module \`${mod}\`. Use: \`antiraid\`, \`antinuke\`, \`antispam\`, \`antiflood\``);
      await updateSettings(guildId, p);
      return reply(api, channelId, `✅ **${mod}.${key}** set to \`${value}\``);
    } catch (err) { return reply(api, channelId, `❌ ${err.message}\n\nRun \`!config\` to see all options.`); }
  }
};

const help = { name: 'help', names: ['help'],
  async execute({ api, guildId, channelId }) {
    const { prefix } = await getSettings(guildId);
    const p = prefix || '!';
    return reply(api, channelId, { embeds: [{ color: 0x5865f2,
      title: '🛡️ FluxerGuard — Commands',
      description: `Current prefix: \`${p}\``,
      fields: [
        { name: '🔨 Moderation', value: [`\`${p}ban <@user|ID> [reason]\``,`\`${p}kick <@user|ID> [reason]\``,`\`${p}warn <@user|ID> <reason>\``,`\`${p}unban <userID> [reason]\``,`\`${p}timeout <@user|ID> <duration> [reason]\``,`\`${p}untimeout <@user|ID> [reason]\``].join('\n') },
        { name: '📋 Cases', value: [`\`${p}case <ID>\``,`\`${p}case history <@user|ID>\``].join('\n') },
        { name: '🛡️ Security', value: [`\`${p}config\``,`\`${p}whitelist add/remove/list\``,`\`${p}blacklist add/remove/list\``].join('\n') },
        { name: '⚙️ Setup', value: [`\`${p}setprefix <prefix>\``,`\`${p}setlog [#channel]\``].join('\n') },
        { name: '⏱️ Duration format', value: '`30s` `10m` `2h` `1d` (max 28d)' },
      ],
      footer: { text: 'FluxerGuard • Multi-Server Security Bot' },
      timestamp: new Date().toISOString() }] });
  }
};

module.exports = setprefix;
module.exports.extra = [setlog, whitelist, blacklist, config, help];
