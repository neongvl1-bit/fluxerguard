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
const FOOTER = 'FluxerGuard';

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
  const caseInfo  = caseEntry ? `\`${caseEntry.caseId}\` • ${caseEntry.auto ? '🤖 Auto' : '👮 Manual'}` : '';
  return embed(COLORS[action] || COLORS.NEUTRAL, `${ICONS[action] || '🔧'}  ${action}  ${caseInfo}`, null, fields);
}

// ── Security alert ────────────────────────────────────────────────────────────
function securityAlert(module, description, fieldsObj, caseEntry) {
  const fields   = Object.entries(fieldsObj).map(([k, v]) => field(k, v, true));
  const caseInfo = caseEntry ? ` • \`${caseEntry.caseId}\`` : '';
  return embed(COLORS[module] || COLORS.ERROR, `${ICONS[module] || '🛡️'}  ${module} Triggered${caseInfo}`, description, fields);
}

// ── Alert only ────────────────────────────────────────────────────────────────
function alertEmbed(module, description, fieldsObj) {
  const fields = Object.entries(fieldsObj).map(([k, v]) => field(k, v, true));
  fields.push(field('⚠️ Action', '**None taken** — alert only mode. Moderators should review.', false));
  return embed(COLORS.WARNING, `${ICONS[module] || '🛡️'}  ${module} Alert — Action Required`, description, fields);
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
  return embed(COLORS.INFO, '⚙️  FluxerGuard Configuration',
    `Prefix: \`${g.prefix}\`  •  Log Channel: ${logStr}`,
    [
      field('🛡️ AntiRaid',
        `*Detects mass join attacks and kicks/bans all of them automatically.*\n` +
        `Enabled: **${g.antiraid_enabled}** | Trigger: **${g.antiraid_threshold}** joins in **${g.antiraid_interval/1000}s** | Action: **${g.antiraid_action}**\n` +
        `*Actions: \`kick\` \`ban\` \`alert\`*`, false),
      field('💥 AntiNuke',
        `*Protects against mass channel/role deletion — bans the executor automatically.*\n` +
        `Enabled: **${g.antinuke_enabled}** | Trigger: **${g.antinuke_threshold}** actions in **${g.antinuke_interval/1000}s** | Action: **${g.antinuke_action || 'ban'}**\n` +
        `*Actions: \`ban\` \`alert\`*`, false),
      field('⚠️ AntiSpam',
        `*Prevents message flooding — punishes users who send too many messages fast.*\n` +
        `Enabled: **${g.antispam_enabled}** | Trigger: **${g.antispam_max_msgs}** msgs in **${g.antispam_interval/1000}s** | Action: **${g.antispam_action}**\n` +
        `*Actions: \`timeout\` \`kick\` \`ban\` \`alert\`*`, false),
      field('🌊 AntiFlood',
        `*Stops repeated identical messages from flooding channels.*\n` +
        `Enabled: **${g.antiflood_enabled}** | Trigger: **${g.antiflood_duplicates}** identical messages | Action: *(shares AntiSpam action)*`, false),
      field('⚙️ How to change', '`!config <module> <key> <value>`\nExample: `!config antiraid action ban`', false),
    ]
  );
}

// ── Help ──────────────────────────────────────────────────────────────────────
function helpEmbed(prefix) {
  const p = prefix || '!';
  return embed(COLORS.INFO, '🛡️  FluxerGuard — Command Reference',
    `Use \`${p}help\` anytime to see this menu.`,
    [
      field('🔨 Moderation', [
        `\`${p}ban <@user|ID> [reason]\``,
        `\`${p}kick <@user|ID> [reason]\``,
        `\`${p}warn <@user|ID> <reason>\``,
        `\`${p}unban <userID> [reason]\``,
        `\`${p}timeout <@user|ID> <duration> [reason]\``,
        `\`${p}untimeout <@user|ID> [reason]\``,
      ].join('\n'), false),
      field('📋 Cases', [
        `\`${p}case <ID>\` — look up a case`,
        `\`${p}case history <@user|ID>\` — full history`,
      ].join('\n'), false),
      field('🛡️ Security', [
        `\`${p}config\` — view/edit all settings`,
        `\`${p}whitelist add/remove/list\``,
        `\`${p}blacklist add/remove/list\``,
      ].join('\n'), false),
      field('🔒 FluxerGuard Systems', [
        `\`${p}guardian\` — server security level`,
        `\`${p}threatlog\` — weekly threat report`,
        `\`${p}lockdown [reason]\` — emergency lockdown`,
        `\`${p}unlockdown\` — lift lockdown`,
        `\`${p}note <@user|ID> <text>\` — add mod note`,
        `\`${p}note list <@user|ID>\` — view notes`,
        `\`${p}note delete <noteID>\` — delete note`,
      ].join('\n'), false),
      field('⚙️ Setup', [
        `\`${p}setprefix <prefix>\``,
        `\`${p}setlog [#channel]\``,
      ].join('\n'), true),
      field('⏱️ Duration Format', '`30s`  `10m`  `2h`  `1d`  *(max 28d)*', true),
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
function threatLogEmbed(stats) {
  const total = (stats.bans||0)+(stats.kicks||0)+(stats.warns||0)+(stats.timeouts||0)+(stats.raids||0)+(stats.nukes||0)+(stats.spams||0);
  return embed(COLORS.INFO, `📊  Threat Report — ${stats.week}`,
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
function lockdownEmbed(active, reason, mod) {
  return embed(
    active ? 0xED4245 : 0x43B581,
    active ? '🔒  Server Lockdown — ACTIVE' : '🔓  Server Lockdown — Lifted',
    active
      ? `This server is under **lockdown**.\nReason: ${reason}`
      : `Lockdown lifted by **${mod}**. Server is back to normal.`,
    active ? [field('Activated by', mod, true), field('Reason', reason, false)] : []
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

module.exports = {
  COLORS, ICONS, field,
  modConfirm, modDM, logEntry, securityAlert, alertEmbed,
  error, success, info,
  warnConfirm, caseEmbed, caseHistory,
  configEmbed, helpEmbed, listEmbed,
  guardianLevelEmbed, threatLogEmbed, lockdownEmbed,
  noteEmbed, notesListEmbed,
};
