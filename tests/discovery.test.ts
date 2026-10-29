import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { resolveCatalogEntry, mergeModel, type Catalog, type GatewayModel } from "../src/resolve.ts"
import { normalizeGatewayPayload } from "../src/discovery.ts"

const here = dirname(fileURLToPath(import.meta.url))
const catalog: Catalog = JSON.parse(readFileSync(join(here, "fixtures", "modelsdev.json"), "utf8"))

const gatewayPayload = JSON.parse(readFileSync(join(here, "fixtures", "gateway-kodeo.json"), "utf8"))
const KODEO_IDS = gatewayPayload.data.map((model: { id: string }) => model.id)

function resolvedIds(): { hit: string[]; miss: string[] } {
  const hit: string[] = []
  const miss: string[] = []
  for (const id of KODEO_IDS) {
    if (resolveCatalogEntry(id, catalog, { providerName: "kodeo" })) hit.push(id)
    else miss.push(id)
  }
  return { hit, miss }
}

test("resolves the large majority of live gateway ids", () => {
  const { hit } = resolvedIds()
  // Every id is a real gateway model; the ones that miss are gateway-internal
  // aliases that no public catalog lists.
  assert.ok(
    hit.length >= 13,
    `expected at least 13 of ${KODEO_IDS.length} to resolve, got ${hit.length}`,
  )
})

test("the only unresolved ids are gateway-internal aliases", () => {
  const { miss } = resolvedIds()
  // Gateway-internal aliases: no public catalog lists these, so they fall
  // back to gateway-only metadata and report pricing as unknown.
  // Exactly the ids no public catalog can own: one gateway alias and one
  // gateway-internal review channel.
  assert.equal(miss.length, 2)
  assert.ok(miss.includes("kodeo-opus-5"))
  assert.ok(miss.some((id) => id.includes("auto-review")))
})

test("never resolves a model to an unrelated vendor", () => {
  // A global id scan would attribute glm-5.3-flash to whichever reseller came
  // first in the catalog. Every hit must land on the model's real vendor.
  const expectedVendor: Record<string, string> = {
    "glm-5.3-flash": "zhipuai",
    "minimax-m2.7": "minimax",
    "grok-4.7": "xai",
    "claude-opus-5": "anthropic",
    "gpt-6-sol": "openai",
  }
  for (const [id, vendor] of Object.entries(expectedVendor)) {
    const hit = resolveCatalogEntry(id, catalog)
    assert.ok(hit, `${id} should resolve`)
    assert.equal(hit.provider, vendor, `${id} resolved to the wrong vendor`)
  }
})

test("a stripped vendor prefix still resolves to the same entry", () => {
  const prefixed = resolveCatalogEntry("anthropic/claude-opus-5-5", catalog)
  const bare = resolveCatalogEntry("claude-opus-5.5", catalog)
  assert.ok(prefixed)
  assert.ok(bare)
  assert.equal(bare.modelId, prefixed.modelId)
})

test("merged output carries pricing for every resolved live id", () => {
  for (const id of KODEO_IDS) {
    const hit = resolveCatalogEntry(id, catalog)
    if (!hit) continue
    const gateway: GatewayModel = {
      id,
      name: id,
      context: 1000,
      output: 1000,
      input: ["text"],
      reasoning: true,
      tools: true,
    }
    const merged = mergeModel(gateway, hit)
    assert.ok(merged.cost, `${id} resolved but produced no cost`)
    assert.equal(typeof merged.cost.input, "number")
  }
})

test("gateway limits win over catalog limits", () => {
  const hit = resolveCatalogEntry("glm-5.3-flash", catalog)
  assert.ok(hit)
  // The gateway reports a different context than the catalog's vendor page.
  const merged = mergeModel(
    { id: "glm-5.3-flash", name: "GLM", context: 200000, output: 32000, input: ["text"], reasoning: true, tools: true },
    hit,
  )
  assert.equal(merged.context, 200000)
  assert.equal(merged.output, 32000)
  assert.ok(merged.cost)
})

test("normalizeGatewayPayload reads the OpenAI-compatible shape", () => {
  const payload = {
    object: "list",
    data: [
      {
        id: "glm-5.3-flash",
        display_name: "GLM 5.3 Flash",
        context_length: 200000,
        max_input_tokens: 200000,
        max_tokens: 32000,
        capabilities: { image_input: { supported: false }, thinking: { supported: true } },
        supported_parameters: ["tools", "stream"],
      },
    ],
  }
  const models = normalizeGatewayPayload(payload)
  assert.equal(models.length, 1)
  assert.equal(models[0].id, "glm-5.3-flash")
  assert.equal(models[0].name, "GLM 5.3 Flash")
  assert.equal(models[0].context, 200000)
  assert.equal(models[0].output, 32000)
  assert.deepEqual(models[0].input, ["text"])
  assert.equal(models[0].tools, true)
})

test("normalizeGatewayPayload skips entries without an id", () => {
  const models = normalizeGatewayPayload({ data: [{ display_name: "orphan" }, { id: "ok" }] })
  assert.deepEqual(models.map((m) => m.id), ["ok"])
})

test("normalizeGatewayPayload tolerates a missing data array", () => {
  assert.deepEqual(normalizeGatewayPayload({}), [])
  assert.deepEqual(normalizeGatewayPayload(null), [])
})
