require('dotenv').config();
const WebSocket = require('ws');
const fetch     = require('node-fetch');

const { handleMessage }  = require('./handlers/commandHandler');
const { handleAntiRaid } = require('./modules/antiRaid');
const { handleAntiNuke } = require('./modules/antiNuke');
const { handleAntiSpam, setOwnerForSpam } = require('./modules/antiSpam');
const { isBlacklisted, createCase, getSettings } = require('./utils/db');
const { setOwner, preloadRoles } = require('./utils/isPrivileged');
const { rolesCache }  = require('./utils/cache');
const { sendLog } = require('./utils/logger');

const TOKEN    = process.env.FLUXER_BOT_TOKEN;
const API_BASE = 'https://api.fluxer.app/v1';

if (!TOKEN)                    { console.error('❌ FLUXER_BOT_TOKEN missing!');  process.exit(1); }
if (!process.env.SUPABASE_URL) { console.error('❌ SUPABASE_URL missing!');      process.exit(1); }

// ── REST ──────────────────────────────────────────────────────────────────────
const api = {
  async request(method, path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Authorization': `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status}: ${text}`);
    try { return JSON.parse(text); } catch { return text; }
  },
  get:    (path)        => api.request('GET',    path),
  post:   (path, body)  => api.request('POST',   path, body),
  put:    (path, body)  => api.request('PUT',    path, body),
  patch:  (path, body)  => api.request('PATCH',  path, body),
  delete: (path)        => api.request('DELETE', path),

  channels: {
    createMessage: (channelId, body) => api.post(`/channels/${channelId}/messages`, body),
    fetch:         (channelId)       => api.get(`/channels/${channelId}`),
  },
  guilds: {
    get:          (guildId)              => api.get(`/guilds/${guildId}`),
    getMember:    (guildId, userId)       => api.get(`/guilds/${guildId}/members/${userId}`),
    getRoles:     (guildId)               => api.get(`/guilds/${guildId}/roles`),
    banUser:      (guildId, userId, body) => api.put(`/guilds/${guildId}/bans/${userId}`, body),
    unbanUser:    (guildId, userId)       => api.delete(`/guilds/${guildId}/bans/${userId}`),
    removeMember: (guildId, userId)       => api.delete(`/guilds/${guildId}/members/${userId}`),
    editMember:   (guildId, userId, body) => api.patch(`/guilds/${guildId}/members/${userId}`, body),
    getAuditLog:  (guildId, params)       => {
      const q = new URLSearchParams(params).toString();
      return api.get(`/guilds/${guildId}/audit-logs?${q}`);
    },
  },
  users: {
    get:      (userId) => api.get(`/users/${userId}`),
    createDM: (userId) => api.post('/users/@me/channels', { recipient_id: userId }),
  },
};

// ── Gateway ───────────────────────────────────────────────────────────────────
let ws, heartbeatInterval, sessionId, resumeUrl, sequence = null;
let botUser      = null;
let reconnecting = false;
let retryDelay   = 3000;

// Intents: GUILDS(1) + GUILD_MEMBERS(2) + GUILD_MESSAGES(512) + MESSAGE_CONTENT(32768) + GUILD_MODERATION(4)
// Total = 1 + 2 + 4 + 512 + 32768 = 33287
// Daca tot pica, incercam si cu 0, 1, 512, 33287
const INTENTS = [
  33287,  // toate cele necesare
  513,    // GUILDS + GUILD_MESSAGES
  32769,  // GUILDS + MESSAGE_CONTENT
  0,      // fara intents (fallback)
];
let intentIndex = 0;

function send(op, d) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ op, d }));
  }
}

function identify() {
  const intents = INTENTS[intentIndex % INTENTS.length];
  console.log(`[GW] Identifying with intents=${intents}...`);
  send(2, {
    token: TOKEN,
    intents,
    properties: { os: 'linux', browser: 'fluxerguard', device: 'fluxerguard' },
  });
}

function startHeartbeat(interval) {
  clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) send(1, sequence);
  }, interval);
}

async function dispatch(event, data) {
  try {
    if (event === 'READY') {
      botUser    = data.user;
      sessionId  = data.session_id;
      resumeUrl  = data.resume_gateway_url || 'wss://gateway.fluxer.app';
      retryDelay = 3000; // reset delay dupa succes
      intentIndex = intentIndex; // pastreaza intentul care a mers
      console.log('\n╔══════════════════════════════════════════╗');
      console.log(`║  FluxerGuard — Online ✅                  ║`);
      console.log(`║  Bot: @${(botUser.username || '?').padEnd(33)}║`);
      console.log(`║  Intents: ${String(INTENTS[intentIndex % INTENTS.length]).padEnd(30)}║`);
      console.log('╚══════════════════════════════════════════╝\n');
    }

    else if (event === 'MESSAGE_CREATE') {
      if (!data.guild_id || data.author?.bot) return;
      await handleAntiSpam(api, data.guild_id, data);
      await handleMessage(api, data);
    }

    else if (event === 'GUILD_CREATE') {
      if (data.id && data.owner_id) { setOwner(data.id, data.owner_id); setOwnerForSpam(data.id, data.owner_id); }
    }

    else if (event === 'GUILD_MEMBER_ADD') {
      const guildId = data.guild_id, userId = data.user?.id;
      if (!guildId || !userId) return;
      if (await isBlacklisted(guildId, userId)) {
        const reason = '[Blacklist] Auto-banned on join';
        try {
          const dm = await api.users.createDM(userId);
          await api.channels.createMessage(dm.id, { content: `You were **auto-banned**. Reason: ${reason}` });
        } catch (_) {}
        await api.guilds.banUser(guildId, userId, { reason });
        const entry = await createCase(guildId, { action: 'BAN', userId, userTag: data.user.username, modId: 'bot', modTag: 'FluxerGuard', reason, auto: true });
        await sendLog(api, guildId, 'BAN', { 'User': `${data.user.username} (${userId})`, 'Reason': reason, 'Case': entry.caseId }, entry);
        return;
      }
      // Lockdown — kick orice user nou
      await handleAntiRaid(api, guildId, data);
    }

    else if (['CHANNEL_DELETE','CHANNEL_CREATE','GUILD_ROLE_DELETE','GUILD_ROLE_CREATE'].includes(event)) {
      const guildId = data.guild_id;
      if (!guildId) return;
      await new Promise(r => setTimeout(r, 1500));
      const typeMap = { CHANNEL_DELETE: 12, CHANNEL_CREATE: 10, GUILD_ROLE_DELETE: 32, GUILD_ROLE_CREATE: 30 };
      try {
        const logs  = await api.guilds.getAuditLog(guildId, { limit: 1, action_type: typeMap[event] });
        const entry = logs?.audit_log_entries?.[0];
        if (!entry) return;
        const ts = Number(BigInt(entry.id) >> 22n) + 1420070400000;
        if (Date.now() - ts > 5000) return;
        handleAntiNuke(api, guildId, event, entry.user_id);
      } catch (_) {}
    }
  } catch (err) {
    console.error(`[DISPATCH ${event}]`, err.message);
  }
}

function connect() {
  if (reconnecting) return;
  reconnecting = true;

  const url = 'wss://gateway.fluxer.app/?v=1&encoding=json';
  console.log(`[GW] Connecting... (attempt with intents=${INTENTS[intentIndex % INTENTS.length]})`);
  ws = new WebSocket(url);

  ws.on('open', () => {
    reconnecting = false;
    console.log('[GW] Connected');
  });

  ws.on('message', async (raw) => {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return; }
    const { op, t, s, d } = parsed;
    if (s !== null && s !== undefined) sequence = s;

    if (op === 10) {           // HELLO
      startHeartbeat(d.heartbeat_interval);
      identify();
      console.log(`[GW] Hello — heartbeat every ${d.heartbeat_interval}ms`);
    }
    else if (op === 11) {}     // Heartbeat ACK
    else if (op === 0) {       // DISPATCH
      await dispatch(t, d);
    }
    else if (op === 9) {       // Invalid Session
      console.log(`[GW] Invalid session (d=${d}) — trying next intent set...`);
      intentIndex++;
      clearInterval(heartbeatInterval);
      ws.close();
      // Asteapta inainte de reconectare (recomandat de protocol)
      setTimeout(() => { reconnecting = false; connect(); }, retryDelay);
      retryDelay = Math.min(retryDelay * 1.5, 30000);
    }
    else if (op === 7) {       // Reconnect
      console.log('[GW] Server requested reconnect');
      ws.close();
    }
    else {
      console.log(`[GW] Unknown op=${op}`);
    }
  });

  ws.on('close', (code, reason) => {
    clearInterval(heartbeatInterval);
    const reasonStr = reason?.toString() || '';
    console.log(`[GW] Closed (code=${code} reason="${reasonStr}")`);
    if (code === 4004) { console.error('❌ Invalid token! Check FLUXER_BOT_TOKEN.'); process.exit(1); }
    if (code === 4013) { console.error('❌ Invalid intents! Gateway rejected our intents.'); }
    if (code === 4014) { console.error('❌ Disallowed intents! Need to enable them in bot settings.'); }
    if (code !== 1000 && code !== 4004) {
      setTimeout(() => { reconnecting = false; connect(); }, retryDelay);
    }
  });

  ws.on('error', err => {
    console.error('[GW ERROR]', err.message);
    reconnecting = false;
  });
}

process.on('unhandledRejection', err => console.error('[UNHANDLED]', err?.message || err));
connect();
