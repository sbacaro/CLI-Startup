import { test } from "node:test"
import assert from "node:assert/strict"

import { skills } from "../src/manifest.ts"

test("includes Graphify with its official PyPI and OpenCode commands", () => {
  const graphify = skills.find((skill) => skill.id === "graphify")
  assert.ok(graphify)
  assert.equal(graphify.repository, "https://github.com/Graphify-Labs/graphify")
  assert.equal(graphify.install, "uv tool install graphifyy && graphify install --platform opencode")
  assert.equal(
    graphify.update,
    "uv tool upgrade graphifyy && graphify install --platform opencode",
  )
  assert.deepEqual(graphify.markers, ["~/.config/opencode/skills/graphify/SKILL.md"])
})
