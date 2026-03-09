/**
 * FluxGuard — Smart Launcher
 * 
 * Ce face:
 *  1. Verifica GitHub daca sunt fisiere noi
 *  2. Daca sunt update-uri, le descarca si restarteza
 *  3. Daca nu sunt, porneste botul direct
 * 
 * Rulare: node start.js
 */

require('dotenv').config();
const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const { spawn } = require('child_process');

const GITHUB_USER   = process.env.GITHUB_USER   || 'neongvl1-bit';
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'fluxerguard';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const FILES = [
  'src/index.js',
  'src/handlers/commandHandler.js',
  'src/commands/admin.js',
  'src/commands/security.js',
  'src/commands/moderation.js',
  'src/modules/antiRaid.js',
  'src/modules/antiNuke.js',
  'src/modules/antiSpam.js',
  'src/utils/embeds.js',
  'src/utils/cache.js',
  'src/utils/isPrivileged.js',
  'src/utils/db.js',
  'src/utils/logger.js',
  'src/utils/modAction.js',
  'src/utils/duration.js',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'FluxGuard-Launcher' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchText(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function startBot() {
  console.log('\n🚀 Starting FluxGuard...\n');
  const bot = spawn('node', ['src/index.js'], {
    cwd:   __dirname,
    stdio: 'inherit',
  });
  bot.on('exit', code => {
    console.log(`\n[Launcher] Bot exited with code ${code}.`);
    if (code !== 0) {
      console.log('[Launcher] Restarting in 5 seconds...');
      setTimeout(startBot, 5000);
    }
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

const readline = require('readline');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim().toLowerCase()); }));
}

async function checkAndStart() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  FluxGuard Launcher                    ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ── 1. UPLOAD local → GitHub (github_setup) ──────────────────────────────
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    console.log('📤 Uploading local files to GitHub...');
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'github_setup.js'), token], {
          stdio: 'inherit', cwd: __dirname
        });
        child.on('close', code => code === 0 ? resolve() : reject(new Error('github_setup failed')));
      });
    } catch (e) {
      console.log(`⚠️  Upload failed: ${e.message}`);
    }
  } else {
    console.log('⚠️  GITHUB_TOKEN not set in .env — skipping upload.\n');
  }

  // ── 2. CHECK GitHub → local ───────────────────────────────────────────────
  if (!GITHUB_USER) {
    console.log('⚠️  GITHUB_USER not set in .env — skipping update check.\n');
    return startBot();
  }

  const base = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
  console.log('\n🔍 Checking for differences from GitHub...');

  let updates = [];
  for (const file of FILES) {
    const localPath = path.join(__dirname, file);
    try {
      const remote = await fetchText(`${base}/${file}`);
      if (!fs.existsSync(localPath)) {
        updates.push({ file, remote, reason: 'new file' });
        continue;
      }
      const local = fs.readFileSync(localPath, 'utf8');
      if (md5(remote) !== md5(local)) {
        updates.push({ file, remote, reason: 'changed' });
      }
    } catch (_) {}
  }

  if (updates.length === 0) {
    console.log('✅ All files are up to date.\n');
    return startBot();
  }

  // ── 3. INTREABA userul ────────────────────────────────────────────────────
  console.log(`\n📦 Found ${updates.length} file(s) different on GitHub:\n`);
  for (const { file, reason } of updates) {
    console.log(`  • ${file.padEnd(45)} [${reason}]`);
  }

  const ans = await ask('\n❓ Do you want to update local files from GitHub? (yes/no): ');

  if (ans === 'yes' || ans === 'y') {
    console.log('');
    let ok = 0;
    for (const { file, remote, reason } of updates) {
      const localPath = path.join(__dirname, file);
      process.stdout.write(`  Updating ${file.padEnd(42)} [${reason}] `);
      try {
        if (fs.existsSync(localPath))
          fs.writeFileSync(localPath + '.bak', fs.readFileSync(localPath));
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, remote, 'utf8');
        console.log('✅');
        ok++;
      } catch (err) {
        console.log(`❌ ${err.message}`);
        if (fs.existsSync(localPath + '.bak'))
          fs.copyFileSync(localPath + '.bak', localPath);
      }
    }
    if (ok === updates.length) {
      for (const { file } of updates) {
        const bak = path.join(__dirname, file + '.bak');
        if (fs.existsSync(bak)) fs.unlinkSync(bak);
      }
    }
    console.log(`\n✅ Updated ${ok}/${updates.length} files.\n`);
  } else {
    console.log('\n⏭️  Skipping update — starting with local files.\n');
  }

  startBot();
}

checkAndStart().catch(err => {
  console.error('\n❌ Launcher error:', err.message);
  console.log('Starting bot anyway...\n');
  startBot();
});
