// Cache centralizat pentru tot botul
// In-memory, cu TTL si cleanup automat

class TTLCache {
  constructor(ttlMs, cleanupIntervalMs) {
    this.store = new Map();
    this.ttl   = ttlMs;
    // Cleanup periodic ca sa nu creasca memoria la infinit
    setInterval(() => this.cleanup(), cleanupIntervalMs || ttlMs);
  }

  set(key, value) {
    this.store.set(key, { value, ts: Date.now() });
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttl) { this.store.delete(key); return undefined; }
    return entry.value;
  }

  has(key) { return this.get(key) !== undefined; }

  delete(key) { this.store.delete(key); }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.ts > this.ttl) this.store.delete(key);
    }
  }

  get size() { return this.store.size; }
}

// Cache-uri globale
module.exports = {
  settingsCache:  new TTLCache(5  * 60 * 1000, 10 * 60 * 1000), // 5 min TTL
  rolesCache:     new TTLCache(10 * 60 * 1000, 15 * 60 * 1000), // 10 min TTL
  memberCache:    new TTLCache(2  * 60 * 1000, 5  * 60 * 1000), // 2 min TTL
  privilegeCache: new TTLCache(30 * 1000,      60 * 1000),       // 30 sec TTL
  ownerCache:     new TTLCache(60 * 60 * 1000, 60 * 60 * 1000), // 1 ora TTL
};
