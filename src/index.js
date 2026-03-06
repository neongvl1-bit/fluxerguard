require('dotenv').config();
const WebSocket = require('ws');
const fetch     = require('node-fetch');

const { handleMessage }  = require('./handlers/commandHandler');
const { handleAntiRaid } = require('./modules/antiRaid');
const { handleAntiNuke } = require('./modules/antiNuke');
const { handleAntiSpam } = require('./modules/antiSpam');
const { isBlacklisted, createCase } = require('./utils/db');
const { sendLog } = require('./utils/logger');

const TOKEN    = process.env.FLUXER_BOT_TOKEN;
const API_BASE = 'https://api.fluxer.app/v1';

if (!TOKEN) { console.error('❌ FLUXER_BOT_TOKEN lipseste!'); process.exit(1); }
if (!process.env.SUPABASE_URL) { console.error('❌ SUPABASE_URL lipseste!'); process.exit(1); }

// ── REST helper ───────────────────────────────────
const api = {
  async request(method, path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Authorization': `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`API ${method} ${path} → ${res.status}: ${err}`);
    }
    if (res.status === 204) return null;
    return res.json();
  },
  get:    (path)         => api.request('GET',    path),
  post:   (path, body)   => api.request('POST',   path, body),
  put:    (path, body)   => api.request('PUT',    path, body),
  patch:  (path, body)   => api.request('PATCH',  path, body),
  delete: (path)         => api.request('DELETE', path),

  // Convenience methods matching command usage
  channels: {
    createMessage: (channelId, body) => api.post(`/channels/${channelId}/messages`, body),
    fetch:         (channelId)       => api.get(`/channels/${channelId}`),
  },
  guilds: {
    getMember:    (guildId, userId) => api.get(`/guilds/${guildId}/members/${userId}`),
    banUser:      (guildId, userId, body) => api.put(`/guilds/${guildId}/bans/${userId}`, body),
    unbanUser:    (guildId, userId)  => api.delete(`/guilds/${guildId}/bans/${userId}`),
    removeMember: (guildId, userId)  => api.delete(`/guilds/${guildId}/members/${userId}`),
    editMember:   (guildId, userId, body) => api.patch(`/guilds/${guildId}/members/${userId}`, body),
    getAuditLog:  (guildId, params)  => {
      const q = new URLSearchParams(params).toString();
      return api.get(`/guilds/${guildId}/audit-logs?${q}`);
    },
  },
  users: {
    get:      (userId) => api.get(`/users/${userId}`),
    createDM: (userId) => api.post('/users/@me/channels', { recipient_id: userId }),
  },
};

// ── Gateway ───────────────────────────────────────
let ws, heartbeatInterval, sessionId, resumeUrl, sequence = null;
let botUser = null;

function send(op, d) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ op, d }));
  }
}

function identify() {
  send(2, {
    token: TOKEN,
    intents: 0,
    properties: { os: 'windows', browser: 'fluxerguard', device: 'fluxerguard' },
  });
}

function startHeartbeat(interval) {
  clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => send(1, sequence), interval);
}

async function dispatch(event, data) {
  try {
    if (event === 'READY') {
      botUser = data.user;
      sessionId = data.session_id;
      resumeUrl = data.resume_gateway_url || 'wss://gateway.fluxer.app';
      console.log('\n╔══════════════════════════════════════════╗');
      console.log(`║  FluxerGuard — Online ✅                  ║`);
      console.log(`║  Bot: @${botUser.username.padEnd(33)}║`);
      console.log('╚══════════════════════════════════════════╝\n');
    }

    else if (event === 'MESSAGE_CREATE') {
      if (!data.guild_id || data.author?.bot) return;
      await handleAntiSpam(api, data.guild_id, data);
      await handleMessage(api, data);
    }

    else if (event === 'GUILD_MEMBER_ADD') {
      const guildId = data.guild_id, userId = data.user.id;
      if (await isBlacklisted(guildId, userId)) {
        const reason = '[Blacklist] Auto-banned on join';
        try { const dm = await api.users.createDM(userId); await api.channels.createMessage(dm.id, { content: `You were **auto-banned**. Reason: ${reason}` }); } catch (_) {}
        await api.guilds.banUser(guildId, userId, { reason });
        const entry = await createCase(guildId, { action: 'BAN', userId, userTag: data.user.username, modId: 'bot', modTag: 'FluxerGuard', reason, auto: true });
        await sendLog(api, guildId, 'BAN', { 'User': `${data.user.username} (${userId})`, 'Reason': reason, 'Case': entry.caseId }, entry);
        return;
      }
      await handleAntiRaid(api, guildId, data);
    }

    else if (['CHANNEL_DELETE','CHANNEL_CREATE','GUILD_ROLE_DELETE','GUILD_ROLE_CREATE'].includes(event)) {
      const guildId = data.guild_id;
      if (!guildId) return;
      await new Promise(r => setTimeout(r, 1500));
      const typeMap = { CHANNEL_DELETE: 12, CHANNEL_CREATE: 10, GUILD_ROLE_DELETE: 32, GUILD_ROLE_CREATE: 30 };
      try {
        const logs  = await api.guilds.getAuditLog(guildId, { limit: 1, action_type: typeMap[event] });
        const entry = logs.audit_log_entries?.[0];
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
  const url = 'wss://gateway.fluxer.app/?v=1&encoding=json';
  console.log(`Connecting to ${url}...`);
  ws = new WebSocket(url);

  ws.on('open', () => console.log('[GW] Connected'));

  ws.on('message', async (raw) => {
    const { op, t, s, d } = JSON.parse(raw);
    if (s) sequence = s;

    if (op === 10) { // HELLO
      startHeartbeat(d.heartbeat_interval);
      identify();
      console.log(`[GW] Hello — heartbeat every ${d.heartbeat_interval}ms`);
    }
    else if (op === 11) { /* heartbeat ack */ }
    else if (op === 0)  { await dispatch(t, d); } // DISPATCH
    else if (op === 9)  { // Invalid session
      console.log('[GW] Invalid session — reconnecting...');
      setTimeout(connect, 3000);
    }
    else if (op === 7) { // Reconnect
      console.log('[GW] Reconnect requested');
      ws.close();
    }
  });

  ws.on('close', (code, reason) => {
    clearInterval(heartbeatInterval);
    console.log(`[GW] Closed (${code}) — reconnecting in 5s...`);
    if (code !== 1000) setTimeout(connect, 5000);
  });

  ws.on('error', err => console.error('[GW ERROR]', err.message));
}

process.on('unhandledRejection', err => console.error('[UNHANDLED]', err?.message || err));
connect();
