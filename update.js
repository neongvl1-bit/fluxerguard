/**
 * FluxerGuard Auto-Updater
 * 
 * Optiunea 1 (recomandata): GitHub Gist
 *   - Mergi la https://gist.github.com
 *   - Creeaza un gist cu un fisier "files.json" care contine URL-urile fisierelor
 *   - Seteaza GIST_RAW_URL mai jos
 * 
 * Optiunea 2: GitHub Repo normal
 *   - Seteaza GITHUB_USER si GITHUB_REPO
 * 
 * Rulare: node update.js
 */

require('dotenv').config();
const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const { execSync } = require('child_process');

// ── CONFIGURATIE — editeaza una din variante ──────
// Varianta A: GitHub repo
const GITHUB_USER   = process.env.GITHUB_USER   || 'neongvl1-bit';
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'fluxerguard';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// Varianta B: URL custom (orice server/pastebin raw)
const CUSTOM_BASE_URL = process.env.UPDATE_URL || '';
// ─────────────────────────────────────────────────

const FILES = [
  'src/index.js',
  'src/handlers/commandHandler.js',
  'src/commands/admin.js',
  'src/commands/moderation.js',
  'src/modules/antiRaid.js',
  'src/modules/antiNuke.js',
  'src/modules/antiSpam.js',
  'src/utils/db.js',
  'src/utils/logger.js',
  'src/utils/modAction.js',
  'src/utils/duration.js',
];

function getBaseUrl() {
  if (CUSTOM_BASE_URL) return CUSTOM_BASE_URL.replace(/\/$/, '');
  if (GITHUB_USER)     return `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
  return null;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'FluxerGuard-Updater' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) return reject(new Error(`404 Not Found: ${url}`));
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function update() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  FluxerGuard Auto-Updater                ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const base = getBaseUrl();
  if (!base) {
    console.error('❌ Nu ai configurat sursa de update!\n');
    console.log('Adauga una din urmatoarele in fisierul .env:\n');
    console.log('  # Optiunea A — GitHub repo:');
    console.log('  GITHUB_USER=username_tau_github\n');
    console.log('  # Optiunea B — URL custom:');
    console.log('  UPDATE_URL=https://raw.githubusercontent.com/user/repo/main\n');
    console.log('Sau editeaza update.js direct si seteaza GITHUB_USER.\n');
    process.exit(1);
  }

  console.log(`📡 Sursa: ${base}\n`);

  let updated = 0, failed = 0;

  for (const file of FILES) {
    const localPath = path.join(__dirname, file);
    const url = `${base}/${file}`;
    process.stdout.write(`  ${file.padEnd(45)} `);
    try {
      const content = await fetchText(url);
      // Backup
      if (fs.existsSync(localPath)) fs.writeFileSync(localPath + '.bak', fs.readFileSync(localPath));
      // Scrie
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, content, 'utf8');
      console.log('✅');
      updated++;
    } catch (err) {
      console.log(`❌ ${err.message}`);
      if (fs.existsSync(localPath + '.bak')) fs.copyFileSync(localPath + '.bak', localPath);
      failed++;
    }
  }

  // Sterge backup-urile
  if (failed === 0) {
    for (const file of FILES) {
      const bak = path.join(__dirname, file + '.bak');
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
    }
  }

  // npm install daca package.json s-a schimbat
  console.log('\n📦 npm install...');
  try {
    execSync('npm install --silent', { cwd: __dirname, stdio: 'inherit' });
    console.log('✅ npm install OK\n');
  } catch (_) {
    console.log('⚠️  npm install a esuat\n');
  }

  console.log('══════════════════════════════════════════');
  console.log(`✅ Updated: ${updated}  ❌ Failed: ${failed}`);
  if (failed === 0) {
    console.log('\n🚀 Gata! Restartează botul: node src/index.js');
  } else {
    console.log('\n⚠️  Unele fisiere nu s-au putut actualiza.');
  }
}

update().catch(err => {
  console.error('❌ Update esuat:', err.message);
  process.exit(1);
});
