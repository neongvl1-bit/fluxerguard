const { getSettings, updateSettings, addWhitelist, removeWhitelist, getWhitelist,
        addBlacklist, removeBlacklist, getBlacklist } = require('../utils/db');

function resolveId(i) { return i ? i.replace(/[<@!>&]/g, '') : null; }
const reply = (api, channelId, text) => api.channels.createMessage(channelId, { content: text });

// ── SETPREFIX ─────────────────────────────────────────────────────────────────
const setprefix = { name: 'setprefix', names: ['setprefix'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    if (!args[0] || args[0].length > 5) return reply(api, channelId,
      '❌ **Usage:** `!setprefix <prefix>`\n**Example:** `!setprefix ?` or `!setprefix g!` _(max 5 chars)_');
    await updateSettings(guildId, { prefix: args[0] });
    return reply(api, channelId, `✅ Prefix changed to \`${args[0]}\``);
  }
};

// ── SETLOG ────────────────────────────────────────────────────────────────────
const setlog = { name: 'setlog', names: ['setlog'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const id = args[0] ? resolveId(args[0]) : channelId;
    await updateSettings(guildId, { log_channel: id });
    return reply(api, channelId, `✅ Log channel set to <#${id}>`);
  }
};

// ── WHITELIST ─────────────────────────────────────────────────────────────────
const whitelist = { name: 'whitelist', names: ['whitelist', 'wl'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const sub = (args[0] || '').toLowerCase();
    if (!sub) return reply(api, channelId,
      '❌ **Usage:**\n`!whitelist add <@user|ID>` — bypass all security\n`!whitelist remove <@user|ID>`\n`!whitelist list`');
    if (sub === 'list') {
      const l = await getWhitelist(guildId);
      if (!l.length) return reply(api, channelId, '📋 The whitelist is empty.');
      return reply(api, channelId, `✅ **Security Whitelist** (${l.length})\n${l.map(id => `• \`${id}\``).join('\n')}`);
    }
    const userId = resolveId(args[1]);
    if (!userId) return reply(api, channelId,
      '❌ **Usage:** `!whitelist add/remove <@user|ID>`');
    if (sub === 'add')    { await addWhitelist(guildId, userId);    return reply(api, channelId, `✅ \`${userId}\` added to whitelist — bypasses all security.`); }
    if (sub === 'remove') { await removeWhitelist(guildId, userId); return reply(api, channelId, `✅ \`${userId}\` removed from whitelist.`); }
    return reply(api, channelId, '❌ Unknown subcommand. Use: `add` / `remove` / `list`');
  }
};

// ── BLACKLIST ─────────────────────────────────────────────────────────────────
const blacklist = { name: 'blacklist', names: ['blacklist', 'bl'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    const sub = (args[0] || '').toLowerCase();
    if (!sub) return reply(api, channelId,
      '❌ **Usage:**\n`!blacklist add <@user|ID>` — auto-ban on join\n`!blacklist remove <@user|ID>`\n`!blacklist list`');
    if (sub === 'list') {
      const l = await getBlacklist(guildId);
      if (!l.length) return reply(api, channelId, '📋 The blacklist is empty.');
      return reply(api, channelId, `🚫 **Security Blacklist** (${l.length})\n${l.map(id => `• \`${id}\``).join('\n')}`);
    }
    const userId = resolveId(args[1]);
    if (!userId) return reply(api, channelId,
      '❌ **Usage:** `!blacklist add/remove <@user|ID>`');
    if (sub === 'add')    { await addBlacklist(guildId, userId);    return reply(api, channelId, `🚫 \`${userId}\` added to blacklist — auto-banned on join.`); }
    if (sub === 'remove') { await removeBlacklist(guildId, userId); return reply(api, channelId, `✅ \`${userId}\` removed from blacklist.`); }
    return reply(api, channelId, '❌ Unknown subcommand. Use: `add` / `remove` / `list`');
  }
};

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG_HELP = `❌ **Usage:** \`!config <module> <key> <value>\`
\`\`\`
!config antiraid  enabled    true/false
!config antiraid  threshold  5
!config antiraid  action     kick/ban

!config antinuke  enabled    true/false
!config antinuke  threshold  3

!config antispam  enabled     true/false
!config antispam  maxmessages 8
!config antispam  action      timeout/kick/ban

!config antiflood enabled     true/false
!config antiflood duplicates  4
\`\`\``;

const config = { name: 'config', names: ['config', 'settings'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    if (!args[0]) {
      const g = await getSettings(guildId);
      const logStr = g.log_channel ? `<#${g.log_channel}>` : '`not set — use !setlog`';
      return reply(api, channelId,
        `⚙️ **FluxerGuard Configuration**\nPrefix: \`${g.prefix}\` | Log: ${logStr}\n\n` +
        `🛡️ **AntiRaid:** enabled=${g.antiraid_enabled} | threshold=${g.antiraid_threshold} joins/${g.antiraid_interval/1000}s | action=${g.antiraid_action}\n` +
        `💥 **AntiNuke:** enabled=${g.antinuke_enabled} | threshold=${g.antinuke_threshold} actions/${g.antinuke_interval/1000}s\n` +
        `⚠️ **AntiSpam:** enabled=${g.antispam_enabled} | max=${g.antispam_max_msgs} msgs | action=${g.antispam_action}\n` +
        `🌊 **AntiFlood:** enabled=${g.antiflood_enabled} | duplicates=${g.antiflood_duplicates}\n\n` +
        `_Use \`!config <module> <key> <value>\` to change settings_`
      );
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

// ── HELP ──────────────────────────────────────────────────────────────────────
const help = { name: 'help', names: ['help'],
  async execute({ api, guildId, channelId }) {
    const { prefix: p } = await getSettings(guildId);
    return reply(api, channelId,
      `🛡️ **FluxerGuard — Commands** | Prefix: \`${p}\`\n\n` +
      `**🔨 Moderation**\n` +
      `\`${p}ban <@user|ID> [reason]\`\n` +
      `\`${p}kick <@user|ID> [reason]\`\n` +
      `\`${p}warn <@user|ID> <reason>\`\n` +
      `\`${p}unban <userID> [reason]\`\n` +
      `\`${p}timeout <@user|ID> <duration> [reason]\`\n` +
      `\`${p}untimeout <@user|ID> [reason]\`\n\n` +
      `**📋 Cases**\n` +
      `\`${p}case <ID>\` — look up a case\n` +
      `\`${p}case history <@user|ID>\` — user history\n\n` +
      `**🛡️ Security**\n` +
      `\`${p}config\` — view/edit security settings\n` +
      `\`${p}whitelist add/remove/list\`\n` +
      `\`${p}blacklist add/remove/list\`\n\n` +
      `**⚙️ Setup**\n` +
      `\`${p}setprefix <prefix>\`\n` +
      `\`${p}setlog [#channel]\`\n\n` +
      `**⏱️ Duration format:** \`30s\` \`10m\` \`2h\` \`1d\` (max 28d)`
    );
  }
};

module.exports = setprefix;
module.exports.extra = [setlog, whitelist, blacklist, config, help];
