import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { canonicalProvider, resolveCatalogEntry, mergeModel } from "../src/resolve.ts"

const here = dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(join(here, "fixtures", "modelsdev.json"), "utf8"))

test("maps a vendor-prefixed gateway id to its canonical provider", () => {
  assert.equal(canonicalProvider("anthropic/claude-opus-5-5"), "anthropic")
  assert.equal(canonicalProvider("openai/gpt-5.3-Claude Opus 5.5"), "openai")
  assert.equal(canonicalProvider("vertex_ai/gemini-3.8-flash"), "google")
})

test("maps a bare gateway id by its model name", () => {
  assert.equal(canonicalProvider("claude-opus-5"), "anthropic")
  assert.equal(canonicalProvider("gpt-6.1-sol"), "openai")
  assert.equal(canonicalProvider("glm-5.3-flash"), "zhipuai")
  assert.equal(canonicalProvider("grok-4.7"), "xai")
})

test("recognizes a gateway-specific Claude alias even without a catalog match", () => {
  assert.equal(canonicalProvider("kodeo-opus-5"), undefined)
  assert.equal(canonicalProvider("Claude Opus 5.5-auto-review"), "anthropic")
})

test("resolves an exact id inside its canonical provider", () => {
  const hit = resolveCatalogEntry("claude-opus-5", catalog)
  assert.ok(hit)
  assert.equal(hit.provider, "anthropic")
  assert.equal(hit.model.cost?.input, 5)
})

test("resolves across dot and dash spellings", () => {
  const dotted = resolveCatalogEntry("claude-haiku-5.5", catalog)
  assert.ok(dotted, "dotted id should resolve")
  assert.equal(dotted.modelId, "claude-haiku-5-5")

  const dashed = resolveCatalogEntry("claude-haiku-5-5", catalog)
  assert.ok(dashed)
  assert.equal(dashed.modelId, "claude-haiku-5-5")
})

test("resolves case-insensitively", () => {
  const hit = resolveCatalogEntry("minimax-m2.7", catalog)
  assert.ok(hit, "lowercase gateway id should match mixed-case catalog id")
  assert.equal(hit.provider, "minimax")
  assert.equal(hit.modelId, "MiniMax-M2.7")
})

test("resolves a prefixed id whose bare part only matches case-insensitively", () => {
  const hit = resolveCatalogEntry("globant_dgx/GLM-5.3-Flash", catalog)
  assert.ok(hit)
  assert.equal(hit.provider, "zhipuai")
})

test("does not match a model that only exists under an unrelated provider", () => {
  // `glm-5.3-flash` exists under several gateways in the full catalog, but the
  // canonical owner is zhipuai. A naive global scan would pick a reseller.
  const hit = resolveCatalogEntry("glm-5.3-flash", catalog)
  assert.ok(hit)
  assert.equal(hit.provider, "zhipuai")
})

test("strips a trailing gateway name from a model id", () => {
  const hit = resolveCatalogEntry("claude-opus-5-kodeo", catalog, { providerName: "kodeo" })
  assert.ok(hit, "expected the gateway suffix to be stripped")
  assert.equal(hit.provider, "anthropic")
  assert.equal(hit.modelId, "claude-opus-5")
})

test("does not strip a suffix that is not the gateway name", () => {
  const hit = resolveCatalogEntry("claude-opus-5-kodeo", catalog, { providerName: "globant" })
  assert.equal(hit, undefined)
})

test("mergeModel keeps gateway facts and borrows catalog economics", () => {
  const merged = mergeModel(
    { id: "claude-opus-5", name: "Claude Opus 5", context: 1000000, output: 64000, input: ["text"], reasoning: true, tools: true },
    resolveCatalogEntry("claude-opus-5", catalog),
  )
  // Gateway owns identity and limits.
  assert.equal(merged.id, "claude-opus-5")
  assert.equal(merged.output, 64000)
  // Catalog owns pricing.
  assert.equal(merged.cost?.input, 5)
  assert.equal(merged.cost?.output, 25)
})

test("mergeModel tolerates a missing catalog entry", () => {
  const merged = mergeModel(
    { id: "kodeo-opus-5", name: "Kodeo Opus 5", context: 1000000, output: 64000, input: ["text"], reasoning: true, tools: true },
    undefined,
  )
  assert.equal(merged.id, "kodeo-opus-5")
  assert.equal(merged.cost, undefined)
})

test("mergeModel maps a context tier into the over shape", () => {
  const merged = mergeModel(
    { id: "gpt-6-sol", name: "GPT-6 Sol", context: 1050000, output: 32000, input: ["text"], reasoning: true, tools: true },
    resolveCatalogEntry("gpt-6-sol", catalog),
  )
  assert.ok(merged.cost?.over, "expected a second pricing tier")
  // The catalog states the real threshold; the legacy `context_over_200k`
  // field name must not override it.
  assert.equal(merged.cost.over.size, 272000)
  assert.equal(merged.cost.over.input, 4)
})
