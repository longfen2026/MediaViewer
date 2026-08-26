// 带 TTL 与容量上限的内存缓存：过期项在读取/写入时移除，超限时淘汰最旧插入的键
class TtlCache {
  constructor({ ttl, max }) {
    this.ttl = ttl;
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.ts >= this.ttl) {
      this.map.delete(key);
      return undefined;
    }
    // 命中后移到末尾，使淘汰顺序接近 LRU
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, { value, ts: Date.now() });
    this.prune();
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }

  prune() {
    const now = Date.now();
    for (const [key, hit] of this.map) {
      if (now - hit.ts >= this.ttl) this.map.delete(key);
    }
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
  }
}

module.exports = { TtlCache };
