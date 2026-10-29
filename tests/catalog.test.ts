import { test } from "node:test"
import assert from "node:assert/strict"

import { CatalogCache } from "../src/cache.ts"
import { loadCatalog, buildProviderModels } from "../src/catalog.ts"
import { normalizeGatewayPayload } from "../src/discovery.ts"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const fixtureCatalog = JSON.parse(readFileSync(join(here, "fixtures", "modelsdev.json"), "utf8"))
const gatewayPayload = JSON.parse(readFileSync(join(here, "fixtures", "gateway-kodeo.json"), "utf8"))

function memoryStorage() {
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

test("loadCatalog fetches once and serves the cache afterwards", async () => {
  let calls = 0
  const cache = new CatalogCache(memoryStorage(), 60_000)
  const fetchImpl = async () => {
    calls++
    return { ok: true, status: 200, json: async () => fixtureCatalog } as unknown as Response
  }

  const first = await loadCatalog(cache, fetchImpl as unknown as typeof fetch)
  const second = await loadCatalog(cache, fetchImpl as unknown as typeof fetch)

  assert.equal(calls, 1, "second load must not hit the network")
  assert.deepEqual(first, second)
  assert.ok(first.anthropic)
})

test("loadCatalog falls back to a stale cache when the network fails", async () => {
  const storage = memoryStorage()
  let now = 1_000
  const cache = new CatalogCache(storage, 1_000, () => now)

  const good = async () => ({ ok: true, status: 200, json: async () => fixtureCatalog }) as unknown as Response
  await loadCatalog(cache, good as unknown as typeof fetch)

  now += 5_000 // expire
  const failing = async () => {
    throw new Error("offline")
  }
  const result = await loadCatalog(cache, failing as unknown as typeof fetch)
  assert.ok(result.anthropic, "expected the stale catalog to be reused")
})

test("loadCatalog returns an empty catalog when nothing is available", async () => {
  const cache = new CatalogCache(memoryStorage(), 60_000)
  const failing = async () => {
    throw new Error("offline")
  }
  const result = await loadCatalog(cache, failing as unknown as typeof fetch)
  assert.deepEqual(result, {})
})

test("buildProviderModels prices every gateway model it can resolve", () => {
  const gateway = normalizeGatewayPayload(gatewayPayload)
  const models = buildProviderModels(gateway, fixtureCatalog, "kodeo")

  assert.equal(models.length, gateway.length, "no gateway model may be dropped")

  const priced = models.filter((m) => m.cost)
  assert.equal(priced.length, 16)

  const unpriced = models.filter((m) => !m.cost).map((m) => m.id)
  assert.equal(unpriced.length, 2)
})

test("buildProviderModels keeps gateway identity and limits", () => {
  const gateway = normalizeGatewayPayload(gatewayPayload)
  const models = buildProviderModels(gateway, fixtureCatalog, "kodeo")

  const glm = models.find((m) => m.id === "glm-5.3-flash")
  assert.ok(glm)
  // The gateway reports 200k; the catalog vendor page says 1M. The gateway is
  // what actually serves the request, so it wins.
  assert.equal(glm.context, 200000)
  assert.equal(glm.output, 32000)
})

test("buildProviderModels produces no duplicate ids", () => {
  const gateway = normalizeGatewayPayload(gatewayPayload)
  const models = buildProviderModels(gateway, fixtureCatalog, "kodeo")
  const ids = models.map((m) => m.id)
  assert.equal(new Set(ids).size, ids.length)
})
