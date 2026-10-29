import { test } from "node:test"
import assert from "node:assert/strict"

import { CatalogCache } from "../src/cache.ts"

const TTL = 24 * 60 * 60 * 1000

function fakeStorage() {
  const map = new Map<string, unknown>()
  return {
    map,
    async get(key: string) {
      return map.get(key)
    },
    async set(key: string, value: unknown) {
      map.set(key, value)
    },
    async remove(key: string) {
      map.delete(key)
    },
  }
}

test("returns the cached value while it is fresh", async () => {
  const storage = fakeStorage()
  const cache = new CatalogCache(storage, TTL, () => 1_000)
  await cache.set("catalog", { anthropic: { models: {} } })

  const hit = await cache.get("catalog")
  assert.deepEqual(hit, { anthropic: { models: {} } })
})

test("expires a value once the TTL passes", async () => {
  let now = 1_000
  const storage = fakeStorage()
  const cache = new CatalogCache(storage, TTL, () => now)
  await cache.set("catalog", { v: 1 })

  now += TTL + 1
  assert.equal(await cache.get("catalog"), undefined)
})

test("keeps the stale value readable after expiry for offline fallback", async () => {
  let now = 1_000
  const storage = fakeStorage()
  const cache = new CatalogCache(storage, TTL, () => now)
  await cache.set("catalog", { v: 1 })

  now += TTL + 1
  assert.equal(await cache.get("catalog"), undefined)
  assert.deepEqual(await cache.getStale("catalog"), { v: 1 })
})

test("reports when a value is missing", async () => {
  const cache = new CatalogCache(fakeStorage(), TTL, () => 1_000)
  assert.equal(await cache.get("absent"), undefined)
  assert.equal(await cache.getStale("absent"), undefined)
})

test("survives a storage backend that throws", async () => {
  const broken = {
    async get() {
      throw new Error("disk on fire")
    },
    async set() {
      throw new Error("disk on fire")
    },
    async remove() {
      throw new Error("disk on fire")
    },
  }
  const cache = new CatalogCache(broken, TTL, () => 1_000)
  // A cache is an optimization; a broken one must never break provisioning.
  assert.equal(await cache.get("x"), undefined)
  assert.equal(await cache.getStale("x"), undefined)
  await cache.set("x", { v: 1 })
})
