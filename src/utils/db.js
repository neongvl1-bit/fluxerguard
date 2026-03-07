require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { settingsCache } = require('./cache');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const DEFAULT = () => ({
  prefix:            process.env.DEFAULT_PREFIX || '!',
  log_channel:       null,
  lockdown_enabled:  false,
  lockdown_reason:   null,
  lockdown_mod:      null,
  antiraid_enabled:  true,  antiraid_threshold: 5,  antiraid_interval: 5000,  antiraid_action: 'kick',
  antinuke_enabled:  true,  antinuke_threshold: 3,  antinuke_interval: 10000, antinuke_action: 'ban',
  antispam_enabled:  true,  antispam_max_msgs:  8,  antispam_interval: 5000,  antispam_action: 'timeout', antispam_timeout_ms: 300000,
  antiflood_enabled: true,  antiflood_duplicates: 4,
});

const caseCounters = new Map();

// ── Batch write queue pentru stats ────────────────────────────────────────────
const statQueue = new Map(); // key: guildId:week:field -> count
let   flushTimer = null;

function queueStat(guildId, field) {
  const week = getWeekKey();
  const key  = `${guildId}:${week}:${field}`;
  statQueue.set(key, (statQueue.get(key) || 0) + 1);
  if (!flushTimer) flushTimer = setTimeout(flushStats, 10000); // flush la 10s
}

async function flushStats() {
  flushTimer = null;
  if (!statQueue.size) return;
  const snapshot = new Map(statQueue);
  statQueue.clear();

  for (const [key, count] of snapshot) {
    const [guildId, week, field] = key.split(':');
    try {
      const { data } = await supabase.from('threat_stats').select(field).eq('guild_id', guildId).eq('week', week).single();
      if (data) {
        await supabase.from('threat_stats').update({ [field]: (data[field] || 0) + count }).eq('guild_id', guildId).eq('week', week);
      } else {
        await supabase.from('threat_stats').insert({ guild_id: guildId, week, [field]: count });
      }
    } catch (_) {}
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function getSettings(guildId) {
  const cached = settingsCache.get(guildId);
  if (cached) return cached;
  const { data } = await supabase.from('guild_settings').select('*').eq('guild_id', guildId).single();
  const s = { ...DEFAULT(), ...(data || {}), guild_id: guildId };
  settingsCache.set(guildId, s);
  return s;
}

async function updateSettings(guildId, patch) {
  await supabase.from('guild_settings').upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() });
  settingsCache.delete(guildId);
  return getSettings(guildId);
}

// ── Cases ─────────────────────────────────────────────────────────────────────
async function createCase(guildId, { action, userId, userTag, modId, modTag, reason, duration = null, auto = false }) {
  if (!caseCounters.has(guildId)) {
    const { count } = await supabase.from('cases').select('*', { count: 'exact', head: true }).eq('guild_id', guildId);
    caseCounters.set(guildId, 1000 + (count || 0));
  }
  const num    = caseCounters.get(guildId);
  const caseId = `CASE-${num}`;
  caseCounters.set(guildId, num + 1);
  const entry  = { case_id: caseId, guild_id: guildId, action, user_id: userId, user_tag: userTag, mod_id: modId, mod_tag: modTag, reason: reason || 'No reason provided', duration, auto, active: true };
  await supabase.from('cases').insert(entry);

  // Queue stat in loc de write imediat
  const validFields = { BAN: 'bans', KICK: 'kicks', WARN: 'warns', TIMEOUT: 'timeouts' };
  const field = validFields[action];
  if (field) queueStat(guildId, field);

  return { ...entry, caseId };
}

async function getCaseById(guildId, caseId) {
  const { data } = await supabase.from('cases').select('*').eq('guild_id', guildId).eq('case_id', caseId.toUpperCase()).single();
  return data;
}

async function getCasesByUser(guildId, userId) {
  const { data } = await supabase.from('cases').select('*').eq('guild_id', guildId).eq('user_id', userId).order('created_at', { ascending: false });
  return data || [];
}

async function deleteCase(guildId, caseId) {
  const { data } = await supabase.from('cases').delete().eq('guild_id', guildId).eq('case_id', caseId.toUpperCase()).select().single();
  return data;
}

// ── Whitelist ─────────────────────────────────────────────────────────────────
const whitelistCache = new Map();

async function isWhitelisted(guildId, userId) {
  const key = `${guildId}:${userId}`;
  if (whitelistCache.has(key)) return whitelistCache.get(key);
  const { data } = await supabase.from('whitelist').select('id').eq('guild_id', guildId).eq('user_id', userId).single();
  const result = !!data;
  whitelistCache.set(key, result);
  setTimeout(() => whitelistCache.delete(key), 60000);
  return result;
}
async function addWhitelist(guildId, userId) {
  await supabase.from('whitelist').upsert({ guild_id: guildId, user_id: userId });
  whitelistCache.delete(`${guildId}:${userId}`);
}
async function removeWhitelist(guildId, userId) {
  await supabase.from('whitelist').delete().eq('guild_id', guildId).eq('user_id', userId);
  whitelistCache.delete(`${guildId}:${userId}`);
}
async function getWhitelist(guildId) {
  const { data } = await supabase.from('whitelist').select('user_id').eq('guild_id', guildId);
  return (data || []).map(r => r.user_id);
}

// ── Blacklist ─────────────────────────────────────────────────────────────────
const blacklistCache = new Map();

async function isBlacklisted(guildId, userId) {
  const key = `${guildId}:${userId}`;
  if (blacklistCache.has(key)) return blacklistCache.get(key);
  const { data } = await supabase.from('blacklist').select('id').eq('guild_id', guildId).eq('user_id', userId).single();
  const result = !!data;
  blacklistCache.set(key, result);
  setTimeout(() => blacklistCache.delete(key), 60000);
  return result;
}
async function addBlacklist(guildId, userId) {
  await supabase.from('blacklist').upsert({ guild_id: guildId, user_id: userId });
  blacklistCache.delete(`${guildId}:${userId}`);
}
async function removeBlacklist(guildId, userId) {
  await supabase.from('blacklist').delete().eq('guild_id', guildId).eq('user_id', userId);
  blacklistCache.delete(`${guildId}:${userId}`);
}
async function getBlacklist(guildId) {
  const { data } = await supabase.from('blacklist').select('user_id').eq('guild_id', guildId);
  return (data || []).map(r => r.user_id);
}

// ── Threat Stats ──────────────────────────────────────────────────────────────
function getWeekKey() {
  const now  = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function incrementStat(guildId, field) {
  queueStat(guildId, field);
}

async function getThreatStats(guildId, weeks = 4) {
  const { data } = await supabase.from('threat_stats').select('*').eq('guild_id', guildId).order('week', { ascending: false }).limit(weeks);
  return data || [];
}

// ── Mod Notes ─────────────────────────────────────────────────────────────────
async function addNote(guildId, userId, note, modId, modTag) {
  const { data } = await supabase.from('mod_notes').insert({ guild_id: guildId, user_id: userId, note, mod_id: modId, mod_tag: modTag }).select().single();
  return data;
}
async function getNotes(guildId, userId) {
  const { data } = await supabase.from('mod_notes').select('*').eq('guild_id', guildId).eq('user_id', userId).order('created_at', { ascending: false });
  return data || [];
}
async function deleteNote(guildId, noteId) {
  const { data } = await supabase.from('mod_notes').delete().eq('guild_id', guildId).eq('id', noteId).select().single();
  return data;
}

module.exports = {
  getSettings, updateSettings,
  createCase, getCaseById, getCasesByUser, deleteCase,
  isWhitelisted, addWhitelist, removeWhitelist, getWhitelist,
  isBlacklisted, addBlacklist, removeBlacklist, getBlacklist,
  incrementStat, getThreatStats,
  addNote, getNotes, deleteNote,
};
