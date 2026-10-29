import { test } from "node:test"
import assert from "node:assert/strict"

import { probeComponent, type Probe } from "../src/components.ts"
import type { UpstreamSkill } from "../src/manifest.ts"

const graphify: UpstreamSkill = {
  id: "graphify",
  name: "Graphify",
  repository: "https://github.com/Graphify-Labs/graphify",
  install: "uv tool install graphifyy && graphify install --platform opencode",
  update: "uv tool upgrade graphifyy && graphify install --platform opencode",
  markers: ["~/.config/opencode/skills/graphify/SKILL.md"],
  versionCommand: "graphify",
}

function probe(overrides: Partial<Probe> = {}): Probe {
  return {
    exists: () => true,
    version: async () => "1.2.3",
    ...overrides,
  }
}

test("reports current when the skill and binary are present", async () => {
  const status = await probeComponent(graphify, probe())
  assert.equal(status.state, "current")
  assert.equal(status.installed, "1.2.3")
  assert.equal(status.id, "graphify")
})

test("reports missing when the skill marker is absent", async () => {
  const status = await probeComponent(
    graphify,
    probe({ exists: (path) => path !== "~/.config/opencode/skills/graphify/SKILL.md" }),
  )
  assert.equal(status.state, "missing")
  assert.equal(status.action, graphify.update)
})

test("reports missing when the binary is absent", async () => {
  const status = await probeComponent(graphify, probe({ version: async () => undefined }))
  assert.equal(status.state, "missing")
})

test("reports unknown when the component declares no way to check", async () => {
  const bare: UpstreamSkill = { ...graphify, markers: [], versionCommand: undefined }
  const status = await probeComponent(bare, probe())
  assert.equal(status.state, "unknown")
})

test("treats a marker without a version command as present", async () => {
  const noVersion: UpstreamSkill = { ...graphify, versionCommand: undefined }
  const status = await probeComponent(noVersion, probe())
  assert.equal(status.state, "current")
})

test("carries the update command so the caller can act on it", async () => {
  const status = await probeComponent(graphify, probe({ exists: () => false }))
  assert.match(status.action ?? "", /uv tool upgrade graphifyy/)
})
