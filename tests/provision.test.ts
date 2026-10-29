import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { toModelInfo, toProviderInfo } from "../src/provision.ts"
import { buildProviderModels } from "../src/catalog.ts"
import { normalizeGatewayPayload } from "../src/discovery.ts"

const here = dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(join(here, "fixtures", "modelsdev.json"), "utf8"))
const gateway = normalizeGatewayPayload(
  JSON.parse(readFileSync(join(here, "fixtures", "gateway-kodeo.json"), "utf8")),
)

const merged = buildProviderModels(gateway, catalog, "kodeo")

test("toProviderInfo describes an OpenAI-compatible gateway", () => {
  const info = toProviderInfo({
    id: "kodeo",
    name: "Kodeo",
    baseURL: "https://api.kodeo.com.br/v1",
    env: ["KODEO_API_KEY"],
    credentialLabel: "Kodeo API key",
  })

  assert.equal(info.id, "kodeo")
  assert.equal(info.name, "Kodeo")
  assert.equal(info.package, "@opencode/ai/providers/openai-compatible")
  assert.equal(info.settings?.baseURL, "https://api.kodeo.com.br/v1")
  assert.equal(info.integrationID, "kodeo")
  // Activation stays enabled so a provider without a key is still listed and
  // prompts for one instead of vanishing from the picker.
  assert.equal(info.activation, "enabled")
})

test("toModelInfo carries identity, limits and capabilities", () => {
  const model = merged.find((m) => m.id === "claude-opus-5")
  assert.ok(model)

  const info = toModelInfo(model, "kodeo")
  assert.equal(info.id, "claude-opus-5")
  assert.equal(info.modelID, "claude-opus-5")
  assert.equal(info.providerID, "kodeo")
  assert.equal(info.name, "Claude Opus 5")
  assert.equal(info.limit.context, 1000000)
  assert.equal(info.limit.output, 64000)
  assert.equal(info.capabilities.tools, true)
  assert.deepEqual(info.capabilities.input, ["text", "image"])
  assert.deepEqual(info.capabilities.output, ["text"])
})

test("toModelInfo emits a single cost tier when there is no long-context price", () => {
  const model = merged.find((m) => m.id === "claude-fable-5")
  assert.ok(model)
  assert.ok(model.cost)
  assert.equal(model.cost.over, undefined)

  const info = toModelInfo(model, "kodeo")
  assert.equal(info.cost.length, 1)
  assert.equal(info.cost[0].input, 10)
  assert.equal(info.cost[0].output, 50)
  assert.equal(info.cost[0].tier, undefined)
})

test("toModelInfo emits a second tier for long-context pricing", () => {
  const model = merged.find((m) => m.id === "gpt-6-sol")
  assert.ok(model)
  assert.ok(model.cost?.over)

  const info = toModelInfo(model, "kodeo")
  assert.equal(info.cost.length, 2)
  assert.equal(info.cost[0].tier, undefined)
  assert.deepEqual(info.cost[1].tier, { type: "context", size: 272000 })
  assert.equal(info.cost[1].input, 4)
})

test("toModelInfo omits cost entirely when pricing is unknown", () => {
  const model = merged.find((m) => m.id === "kodeo-opus-5")
  assert.ok(model)
  assert.equal(model.cost, undefined)

  const info = toModelInfo(model, "kodeo")
  assert.deepEqual(info.cost, [])
})

test("toModelInfo keeps tool and media capabilities", () => {
  const info = toModelInfo(merged.find((m) => m.id === "gpt-5.5")!, "kodeo")
  assert.equal(info.capabilities.tools, true)
  assert.deepEqual(info.capabilities.output, ["text"])
})

test("every merged model converts without throwing", () => {
  for (const model of merged) {
    const info = toModelInfo(model, "kodeo")
    assert.equal(info.providerID, "kodeo")
    assert.ok(info.limit.context > 0)
    assert.ok(info.limit.output > 0)
  }
})
