require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const DEFAULT = () => ({
  prefix: process.env.DEFAULT_PREFIX || '!',
  log_channel:      null,
  lockdown_enabled: false,
  antiraid_enabled:  true,  antiraid_threshold: 5,  antiraid_interval: 5000,  antiraid_action: 'kick',
  antinuke_enabled:  true,  antinuke_threshold: 3,  antinuke_interval: 10000, antinuke_action: 'ban',
  antispam_enabled:  true,  antispam_max_msgs:  8,  antispam_interval: 5000,  antispam_action: 'timeout', antispam_timeout_ms: 300000,
  antiflood_enabled: true,  antiflood_duplicates: 4,
});

const cache        = new Map();
const caseCounters = new Map();

// ── Settings ──────────────────────────────────────────────────────────────────
async function getSettings(guildId) {
  if (cache.has(guildId)) return cache.get(guildId);
  const { data } = await supabase.from('guild_settings').select('*').eq('guild_id', guildId).single();
  const s = { ...DEFAULT(), ...(data || {}), guild_id: guildId };
  cache.set(guildId, s);
  return s;
}

async function updateSettings(guildId, patch) {
  await supabase.from('guild_settings').upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() });
  cache.delete(guildId);
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

  // Actualizeaza threat stats
  await incrementStat(guildId, action.toLowerCase() + 's').catch(() => {});

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

// ── Whitelist ─────────────────────────────────────────────────────────────────
async function isWhitelisted(guildId, userId) {
  const { data } = await supabase.from('whitelist').select('id').eq('guild_id', guildId).eq('user_id', userId).single();
  return !!data;
}
async function addWhitelist(guildId, userId)    { await supabase.from('whitelist').upsert({ guild_id: guildId, user_id: userId }); }
async function removeWhitelist(guildId, userId) { await supabase.from('whitelist').delete().eq('guild_id', guildId).eq('user_id', userId); }
async function getWhitelist(guildId) {
  const { data } = await supabase.from('whitelist').select('user_id').eq('guild_id', guildId);
  return (data || []).map(r => r.user_id);
}

// ── Blacklist ─────────────────────────────────────────────────────────────────
async function isBlacklisted(guildId, userId) {
  const { data } = await supabase.from('blacklist').select('id').eq('guild_id', guildId).eq('user_id', userId).single();
  return !!data;
}
async function addBlacklist(guildId, userId)    { await supabase.from('blacklist').upsert({ guild_id: guildId, user_id: userId }); }
async function removeBlacklist(guildId, userId) { await supabase.from('blacklist').delete().eq('guild_id', guildId).eq('user_id', userId); }
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
  const week = getWeekKey();
  const validFields = ['bans','kicks','warns','timeouts','raids','nukes','spams'];
  const col = field.endsWith('s') ? field : field + 's';
  if (!validFields.includes(col)) return;
  const { data } = await supabase.from('threat_stats').select('*').eq('guild_id', guildId).eq('week', week).single();
  if (data) {
    await supabase.from('threat_stats').update({ [col]: (data[col] || 0) + 1 }).eq('guild_id', guildId).eq('week', week);
  } else {
    await supabase.from('threat_stats').insert({ guild_id: guildId, week, [col]: 1 });
  }
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
  createCase, getCaseById, getCasesByUser,
  isWhitelisted, addWhitelist, removeWhitelist, getWhitelist,
  isBlacklisted, addBlacklist, removeBlacklist, getBlacklist,
  incrementStat, getThreatStats,
  addNote, getNotes, deleteNote,
};
