const { execSync, spawn } = require('child_process');
const path = require('path');

console.log('\n╔══════════════════════════════════════════╗');
console.log('║  FluxGuard — Starting...                 ║');
console.log('╚══════════════════════════════════════════╝\n');

// npm install
console.log('📦 Installing dependencies...');
try {
  execSync('npm install', { cwd: __dirname, stdio: 'inherit' });
  console.log('✅ Dependencies ready\n');
} catch (err) {
  console.error('❌ npm install failed:', err.message);
  process.exit(1);
}

// Start bot
console.log('🚀 Starting FluxGuard...\n');
const bot = spawn('node', ['src/index.js'], {
  cwd: __dirname,
  stdio: 'inherit',
});

bot.on('error', err => {
  console.error('❌ Failed to start:', err.message);
  process.exit(1);
});

bot.on('close', code => {
  process.exit(code || 0);
});
