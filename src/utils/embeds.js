const COLORS = {
  BAN:0xED4245, KICK:0xFF7043, WARN:0xFFC107, TIMEOUT:0x5B9BD5, UNBAN:0x43B581, UNTIMEOUT:0x43B581,
  ANTIRAID:0xFF5252, ANTINUKE:0xFF6D00, ANTISPAM:0xFFAB00,
  INFO:0x5865F2, SUCCESS:0x43B581, ERROR:0xED4245, WARNING:0xFFC107, NEUTRAL:0x2F3136,
};
const ICONS = {
  BAN:'🔨', KICK:'👢', WARN:'⚠️', TIMEOUT:'⏱️', UNBAN:'✅', UNTIMEOUT:'✅',
  ANTIRAID:'🛡️', ANTINUKE:'💥', ANTISPAM:'🚫',
  INFO:'ℹ️', SUCCESS:'✅', ERROR:'❌', SHIELD:'🛡️', CASE:'📋', SETTINGS:'⚙️',
};
const FOOTER = 'FluxGuard';

function ts() { return new Date().toISOString(); }

function embed(color, title, description, fields = [], extra = {}) {
  return { embeds: [{ color, title, description: description || undefined,
    fields: fields.length ? fields : undefined,
    footer: { text: FOOTER }, timestamp: ts(), ...extra }] };
}

function field(name, value, inline = false) {
  return { name, value: String(value || '—'), inline };
}

// ── Mod confirm ───────────────────────────────────────────────────────────────
function modConfirm(action, targetUser, reason, caseId, duration) {
  const fields = [
    field('User',    `**${targetUser.username}**\n\`${targetUser.id}\``, true),
    field('Reason',  reason,                                              true),
    field('Case ID', `\`${caseId}\``,                                    true),
  ];
  if (duration) fields.push(field('Duration', `\`${duration}\``, true));
  return embed(COLORS[action] || COLORS.INFO, `${ICONS[action] || '🔧'}  ${action}`, null, fields);
}

// ── DM ────────────────────────────────────────────────────────────────────────
function modDM(action, serverName, reason, caseId, modUsername, duration) {
  const desc = {
    BAN:       `You have been **permanently banned** from **${serverName}**.`,
    KICK:      `You have been **kicked** from **${serverName}**.`,
    WARN:      `You have received a **warning** in **${serverName}**.`,
    TIMEOUT:   `You have been **timed out** in **${serverName}** for \`${duration}\`.`,
    UNBAN:     `Your ban in **${serverName}** has been **lifted**.`,
    UNTIMEOUT: `Your timeout in **${serverName}** has been **removed**.`,
  }[action] || `Action **${action}** was taken in **${serverName}**.`;
  const fields = [
    field('Reason',    reason,      true),
    field('Moderator', modUsername, true),
    field('Case ID',   `\`${caseId}\``, true),
  ];
  if (duration && action === 'TIMEOUT') fields.push(field('Duration', `\`${duration}\``, true));
  return embed(COLORS[action] || COLORS.INFO, `${ICONS[action] || '🔧'}  ${action}`, desc, fields);
}

// ── Log entry ─────────────────────────────────────────────────────────────────
function logEntry(action, fieldsObj, caseEntry) {
  const fields    = Object.entries(fieldsObj).map(([k, v]) => field(k, v, true));
  const caseInfo  = (caseEntry && caseEntry.caseId) ? ` • \`${caseEntry.caseId}\` • ${caseEntry.auto ? '🤖 Auto' : '👮 Manual'}` : '';
  return embed(COLORS[action] || COLORS.NEUTRAL, `${ICONS[action] || '🔧'}  ${action}${caseInfo}`, null, fields);
}

// ── Security alert ────────────────────────────────────────────────────────────
function securityAlert(module, description, fieldsObj, caseEntry) {
  const fields   = Object.entries(fieldsObj).map(([k, v]) => field(k, v, true));
  const caseInfo = caseEntry ? ` • \`${caseEntry.caseId}\`` : '';
  return embed(COLORS[module] || COLORS.ERROR, `${ICONS[module] || '🛡️'}  ${module} Triggered${caseInfo}`, description, fields);
}

// ── Alert only ────────────────────────────────────────────────────────────────
function alertEmbed(module, description, fieldsObj, action = 'alert') {
  const act = (action || 'alert').toLowerCase();

  const colorMap = {
    ban:      0xE74C3C,  // rosu
    kick:     0xE67E22,  // portocaliu
    timeout:  0xF1C40F,  // galben
    untimeout:0x2ECC71,  // verde
    unban:    0x2ECC71,  // verde
    alert:    0x3498DB,  // albastru
  };
  const titleMap = {
    ban:      `${ICONS[module] || '🛡️'}  ${module} — User Banned`,
    kick:     `${ICONS[module] || '🛡️'}  ${module} — User Kicked`,
    timeout:  `${ICONS[module] || '🛡️'}  ${module} — User Timed Out`,
    untimeout:`${ICONS[module] || '🛡️'}  ${module} — Timeout Removed`,
    unban:    `${ICONS[module] || '🛡️'}  ${module} — User Unbanned`,
    alert:    `${ICONS[module] || '🛡️'}  ${module} — Alert`,
  };

  const color = colorMap[act] ?? COLORS.WARNING;
  const title = titleMap[act] ?? `${ICONS[module] || '🛡️'}  ${module} — Action Taken`;

  const fields = Object.entries(fieldsObj).map(([k, v]) => field(k, String(v ?? ''), true));
  if (act === 'alert') fields.push(field('⚠️ Note', '**No action taken** — alert only mode. Moderators should review.', false));

  return embed(color, title, description, fields);
}

// ── Generic ───────────────────────────────────────────────────────────────────
function error(title, description)            { return embed(COLORS.ERROR,   `❌  ${title}`, description); }
function success(title, description)          { return embed(COLORS.SUCCESS,  `✅  ${title}`, description); }
function info(title, description, fields = []) { return embed(COLORS.INFO,   title, description, fields); }

// ── Warn confirm ──────────────────────────────────────────────────────────────
function warnConfirm(targetUser, reason, caseId, totalWarns) {
  return embed(COLORS.WARN || COLORS.WARNING, '⚠️  Warning Issued', null, [
    field('User',           `**${targetUser.username}**\n\`${targetUser.id}\``, true),
    field('Total Warnings', `**${totalWarns}**`,                                 true),
    field('Case ID',        `\`${caseId}\``,                                     true),
    field('Reason',         reason,                                               false),
  ]);
}

// ── Case ──────────────────────────────────────────────────────────────────────
function caseEmbed(c) {
  const fields = [
    field('User',      `${c.user_tag}\n\`${c.user_id}\``,       true),
    field('Moderator', c.mod_tag,                                true),
    field('Type',      c.auto ? '🤖 Auto' : '👮 Manual',        true),
    field('Reason',    c.reason,                                 false),
    field('Date',      new Date(c.created_at).toLocaleString(), true),
  ];
  if (c.duration) fields.push(field('Duration', `\`${c.duration}\``, true));
  return embed(COLORS[c.action] || COLORS.INFO, `📋  ${c.case_id} — ${c.action}`, null, fields);
}

function caseHistory(userId, cases) {
  const description = cases.slice(0, 10).map(c =>
    `\`${c.case_id}\` **${c.action}**${c.auto ? ' 🤖' : ''} — ${c.reason.slice(0, 50)}${c.reason.length > 50 ? '…' : ''}`
  ).join('\n');
  return embed(COLORS.INFO, '📋  Case History', description, [
    field('User',  `\`${userId}\``,        true),
    field('Total', `**${cases.length}**`,  true),
    ...(cases.length > 10 ? [field('Note', `Showing latest 10 of ${cases.length}`)] : []),
  ]);
}

// ── Config ────────────────────────────────────────────────────────────────────
function configEmbed(g) {
  const logStr = g.log_channel ? `<#${g.log_channel}>` : '`not set`';
  return embed(COLORS.INFO, '⚙️  FluxGuard Configuration',
    `Prefix: \`${g.prefix}\`  •  Log Channel: ${logStr}`,
    [
      field('🛡️ AntiRaid',
        `*Detects mass join attacks and kicks/bans all of them automatically.*\n` +
        `Enabled: **${g.antiraid_enabled}** | Trigger: **${g.antiraid_threshold}** joins in **${g.antiraid_interval/1000}s** | Action: **${g.antiraid_action}**\n` +
        `*Actions: \`kick\` \`ban\` \`lockdown\` \`alert\`*`, false),
      field('💥 AntiNuke',
        `-# ⚠️ This setting affects critical server protection. Modify with caution.\n` +
        `*Protects against mass channel/role deletion — bans the executor automatically.*\n` +
        `Enabled: **${g.antinuke_enabled}** | Trigger: **${g.antinuke_threshold}** actions in **${g.antinuke_interval/1000}s** | Action: **${g.antinuke_action || 'ban'}**\n` +
        `*Actions: \`ban\` \`alert\`*`, false),
      field('⚠️ AntiSpam',
        `*Prevents message flooding — punishes users who send too many messages fast.*\n` +
        `Enabled: **${g.antispam_enabled}** | Trigger: **${g.antispam_max_msgs}** msgs in **${g.antispam_interval/1000}s** | Action: **${g.antispam_action}**` +
        (g.antispam_action === 'timeout' ? ` | Timeout: **${Math.round((g.antispam_timeout_ms||300000)/60000)}m**` : '') + `\n` +
        `*Actions: \`timeout\` \`kick\` \`ban\` \`alert\`*`, false),
      field('🌊 AntiFlood',
        `*Stops repeated identical messages from flooding channels.*\n` +
        `Enabled: **${g.antiflood_enabled}** | Trigger: **${g.antiflood_duplicates}** identical messages | Action: *(shares AntiSpam action)*`, false),
      field('🛡️ Guardian Level', 'Run `!guardian` to see your server security score (0–5).\nIt checks which modules are active and gives tips to improve protection.', false),
      field('⚙️ How to change',
        `**Enable/Disable a module:**\n\`${g.prefix}config <module> enable\` or \`${g.prefix}config <module> disable\`\n` +
        `**Change a setting:**\n\`${g.prefix}config <module> <key> <value>\`\n` +
        `**Examples:**\n\`${g.prefix}config antispam disable\` — turn off AntiSpam\n\`${g.prefix}config antiraid action ban\` — set AntiRaid action to ban\n\`${g.prefix}config antinuke threshold 5\` — set AntiNuke threshold\n` +
        `Run \`${g.prefix}guardian\` after changes to see the updated security level.`, false),
    ]
  );
}

// ── Help ──────────────────────────────────────────────────────────────────────
function helpEmbed(prefix, category) {
  const p = prefix || 'fg!';

  if (category) {
    const cats = {
      moderation: {
        icon: '🔨', title: 'Moderation Commands',
        fields: [
          field('🔨 Ban / Kick / Unban',
            `\`${p}ban <@user|ID> [reason]\` — permanently ban a user\n` +
            `\`${p}kick <@user|ID> [reason]\` — remove a user from the server\n` +
            `\`${p}unban <userID> [reason]\` — remove a ban`,
            false),
          field('⚠️ Warn / Delete Warning',
            `\`${p}warn <@user|ID> <reason>\` — issue a warning\n` +
            `\`${p}delwarn <@user|ID> <caseID>\` — delete a specific warning\n` +
            `*Use \`${p}case history @user\` to find case IDs*`,
            false),
          field('⏱️ Timeout / Untimeout',
            `\`${p}timeout <@user|ID> <duration> [reason]\` — mute a user\n` +
            `\`${p}untimeout <@user|ID> [reason]\` — remove timeout\n` +
            `*Aliases: \`${p}mute\` / \`${p}unmute\`*`,
            false),
          field('📋 Cases',
            `\`${p}case <ID>\` — look up a specific case\n` +
            `\`${p}case history <@user|ID>\` — view all cases for a user`,
            false),
          field('🧹 Clear / Purge',
            `\`${p}clear <1-100>\` — delete messages in the current channel\n` +
            `*Alias: \`${p}purge\`*`,
            false),
          field('⏱️ Duration Format', '`30s`  `10m`  `2h`  `1d`  *(max 28d)*', false),
        ]
      },
      security: {
        icon: '🛡️', title: 'Security Commands',
        fields: [
          field('⚙️ Config',
            `\`${p}config\` — view all settings\n` +
            `\`${p}config <module> enable/disable\` — turn a module on or off\n` +
            `*Modules: \`antiraid\` · \`antinuke\` · \`antispam\` · \`antiflood\`*\n\n` +
            `\`${p}config antiraid   action <kick|ban|lockdown|alert>  |  threshold <n>  |  interval <ms>\`\n` +
            `\`${p}config antinuke   action <ban|alert>                |  threshold <n>  |  interval <ms>\`\n` +
            `\`${p}config antispam   action <timeout|kick|ban|alert>   |  max <n>  |  timeout <ms>  |  publicmsg on/off\`\n` +
            `\`${p}config antiflood  duplicates <n>\``,
            false),
          field('✅ Whitelist  ·  🚫 Blacklist',
            `\`${p}whitelist add/remove/list <@user|ID|@role>\`\n` +
            `\`${p}blacklist add/remove/list <@user|ID|@role>\`\n\n` +
            `✅ **Whitelisted** → bypass all auto-protection\n` +
            `🚫 **Blacklisted** → auto-banned on join\n` +
            `*Aliases: \`${p}wl\` · \`${p}bl\`*`,
            false),
          field('🔒 Lockdown  ·  🔍 Intel  ·  📝 Notes  ·  🔔 Alerts',
            `\`${p}lockdown [reason]\`  /  \`${p}unlockdown\`\n\n` +
            `\`${p}guardian\` — security score\n` +
            `\`${p}threatlog\` — weekly report  *(${p}threats · ${p}stats)*\n` +
            `\`${p}lookup <@user|ID>\` — full user profile  *(${p}whois)*\n\n` +
            `\`${p}note <@user|ID> <text>\` — add note\n` +
            `\`${p}note list/delete <@user|ID|noteID>\`\n\n` +
            `\`${p}alertrole add/remove @role\`\n` +
            `\`${p}alertrole on/off\` — toggle alert pings`,
            false),
        ]
      },
      setup: {
        icon: '⚙️', title: 'Setup & Admin Commands',
        fields: [
          field('🔧 Basic Setup',
            `\`${p}setprefix <prefix>\` — change the command prefix\n` +
            `\`${p}setlog [#channel]\` — set the log channel (leave blank to disable)`,
            false),
          field('📋 Config Overview',
            `\`${p}config\` — view all current module settings at a glance\n` +
            `\`${p}config <module> enable/disable\` — toggle a module on/off\n` +
            `*Modules: \`antiraid\`, \`antinuke\`, \`antispam\`, \`antiflood\`*`,
            false),
          field('🤖 Bot Info',
            `\`${p}botinfo\` — version, uptime, server count\n` +
            `\`${p}ping\` — roundtrip & gateway latency`,
            false),
          field('⏱️ Duration Format', '`30s`  `10m`  `2h`  `1d`  *(max 28d)*', false),
          field('💡 Tip',
            `Privileged users (Admins, Server Owner, users with Ban/Kick/Manage Server) bypass all auto-protection modules automatically.`,
            false),
        ]
      }
    };
    const cat = cats[category.toLowerCase()];
    if (!cat) return embed(COLORS.ERROR, '❌ Unknown Category',
      `Valid categories: \`moderation\`, \`security\`, \`setup\`\nUsage: \`${p}help <category>\``, []);
    return embed(COLORS.INFO, `${cat.icon}  ${cat.title}`,
      `Use \`${p}help\` to return to the main menu.`, cat.fields);
  }

  return embed(COLORS.INFO, '🛡️  FluxGuard — Help',
    'A powerful security & moderation bot for Fluxer.\nChoose a category below for detailed commands:',
    [
      field('🔨 Moderation', `\`${p}help moderation\`\nban, kick, warn, timeout, clear, cases…`, true),
      field('🛡️ Security',   `\`${p}help security\`\nconfig, whitelist, blacklist, lockdown…`, true),
      field('⚙️ Setup',      `\`${p}help setup\`\nprefix, log channel, bot info…`, true),
      field('📌 Quick Start',
        `**1.** \`${p}setlog #channel\` — enable logging\n` +
        `**2.** \`${p}config\` — review protection settings\n` +
        `**3.** \`${p}whitelist add @user\` — exempt trusted users\n` +
        `**4.** \`${p}guardian\` — check your security score`,
        false),
      field('🤖 Bot',
        `\`${p}botinfo\` — stats & uptime  •  \`${p}ping\` — latency`,
        false),
      field('\u200b',
        `[➕ Add FluxGuard](https://web.fluxer.app/oauth2/authorize?client_id=1479261972163135794&scope=bot&permissions=15763699713353790)  •  [💬 Support Server](https://fluxer.gg/0mLkdw2i)`,
        false),
    ]
  );
}
// ── List ──────────────────────────────────────────────────────────────────────
function listEmbed(type, ids) {
  const isWhite = type === 'whitelist';
  const color   = isWhite ? COLORS.SUCCESS : COLORS.ERROR;
  const icon    = isWhite ? '✅' : '🚫';
  const desc    = ids.length ? ids.map(id => `\`${id}\``).join('\n') : '*Empty*';
  const note    = isWhite ? 'Whitelisted users bypass all auto-security modules.' : 'Blacklisted users are auto-banned on join.';
  return embed(color, `${icon}  ${isWhite ? 'Whitelist' : 'Blacklist'}  (${ids.length})`, desc, [field('ℹ️ Note', note, false)]);
}

// ── Guardian Level ────────────────────────────────────────────────────────────
function guardianLevelEmbed(level, score, details) {
  const levels = [
    { label: 'Unprotected', color: 0x8B0000, bar: '░░░░░' },
    { label: 'Low',         color: 0xED4245, bar: '█░░░░' },
    { label: 'Medium',      color: 0xFFC107, bar: '██░░░' },
    { label: 'Good',        color: 0x3498DB, bar: '███░░' },
    { label: 'High',        color: 0x43B581, bar: '████░' },
    { label: 'Maximum',     color: 0x9B59B6, bar: '█████' },
  ];
  const l = levels[Math.min(level, 5)];
  return embed(l.color, `🛡️  Guardian Level ${level}/5 — ${l.label}`,
    `Security Score: \`${l.bar}\` **${score}/100**`, details);
}

// ── Threat Log ────────────────────────────────────────────────────────────────
function getWeekDateRange(weekStr) {
  // weekStr format: "2026-W11"
  const [year, w] = weekStr.split('-W');
  const weekNum = parseInt(w);
  // ISO 8601: week 1 is the week containing the first Thursday of the year
  // Monday of week N = Jan 4 of that year + (N-1)*7 days, adjusted to Monday
  const jan4 = new Date(parseInt(year), 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1 + (weekNum - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function threatLogEmbed(stats) {
  const total = (stats.bans||0)+(stats.kicks||0)+(stats.warns||0)+(stats.timeouts||0)+(stats.raids||0)+(stats.nukes||0)+(stats.spams||0);
  const range = getWeekDateRange(stats.week);
  return embed(COLORS.INFO, `📊  Threat Report — ${stats.week}  (${range})`,
    `**${total}** total threats handled this week`,
    [
      field('🔨 Bans',     String(stats.bans     || 0), true),
      field('👢 Kicks',    String(stats.kicks    || 0), true),
      field('⚠️ Warns',    String(stats.warns    || 0), true),
      field('⏱️ Timeouts', String(stats.timeouts || 0), true),
      field('🛡️ Raids',    String(stats.raids    || 0), true),
      field('💥 Nukes',    String(stats.nukes    || 0), true),
      field('🚫 Spams',    String(stats.spams    || 0), true),
    ]
  );
}

// ── Lockdown ──────────────────────────────────────────────────────────────────
function lockdownEmbed(active, reason, mod, channelCount = 0) {
  const fields = active
    ? [field('Activated by', mod, true), field('Channels Locked', String(channelCount), true), field('Reason', reason, false)]
    : [field('Lifted by', mod, true), field('Channels Restored', String(channelCount), true)];
  return embed(
    active ? 0xED4245 : 0x43B581,
    active ? '🔒  Server Lockdown — ACTIVE' : '🔓  Server Lockdown — Lifted',
    active
      ? `This server is under **lockdown**. @everyone can no longer send messages or add reactions.\nReason: ${reason}`
      : `Lockdown lifted by **${mod}**. Permissions have been restored to their original state.`,
    fields
  );
}

// ── Mod Notes ─────────────────────────────────────────────────────────────────
function noteEmbed(note) {
  return embed(COLORS.WARNING, '📝  Mod Note Added', note.note, [
    field('User',    `\`${note.user_id}\``,                      true),
    field('By',      note.mod_tag,                               true),
    field('Note ID', `#${note.id}`,                              true),
    field('Date',    new Date(note.created_at).toLocaleString(), true),
  ]);
}

function notesListEmbed(userId, notes) {
  const desc = notes.length
    ? notes.map(n =>
        `**#${n.id}** — ${n.note.slice(0, 80)}${n.note.length > 80 ? '…' : ''}\n*by ${n.mod_tag} • ${new Date(n.created_at).toLocaleDateString()}*`
      ).join('\n\n')
    : '*No notes on record.*';
  return embed(COLORS.WARNING, `📝  Mod Notes — \`${userId}\``, desc, [
    field('Total', String(notes.length), true),
  ]);
}

// ── Alert Ping Helper ─────────────────────────────────────────────────────────
// Trimite ping-ul rolurilor configurate in log channel cand e alert mode
async function sendAlertPing(api, guildId, module) {
  const { getSettings } = require('../utils/db');
  const s = await getSettings(guildId);
  if (!s.log_channel) return;
  if (s.alert_ping_enabled === false) return;
  const roles = Array.isArray(s.alert_roles) ? s.alert_roles : [];
  if (!roles.length) return;
  const mention = roles.map(r => `<@&${r}>`).join(' ');
  await api.channels.createMessage(s.log_channel, {
    content: `${mention} ⚠️ **${module} Alert** — manual review required.`,
  }).catch(() => {});
}

module.exports = {
  COLORS, ICONS, field,
  modConfirm, modDM, logEntry, securityAlert, alertEmbed,
  error, success, info,
  warnConfirm, caseEmbed, caseHistory,
  configEmbed, helpEmbed, listEmbed,
  guardianLevelEmbed, threatLogEmbed, lockdownEmbed, sendAlertPing,
  noteEmbed, notesListEmbed,
};
