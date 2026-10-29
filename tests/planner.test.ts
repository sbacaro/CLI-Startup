import { test } from "node:test"
import assert from "node:assert/strict"

import { planInstall, type Environment } from "../src/planner.ts"
import { mcps, skills } from "../src/manifest.ts"

function env(overrides: Partial<Environment> = {}): Environment {
  return {
    hasCommand: async () => true,
    exists: () => true,
    ...overrides,
  }
}

test("an already provisioned machine produces no install commands", async () => {
  const plan = await planInstall(mcps, skills, env())
  assert.deepEqual(plan.install, [])
  assert.deepEqual(plan.setup, [])
})

test("a missing local MCP prerequisite schedules its installer", async () => {
  const plan = await planInstall(
    mcps,
    [],
    env({ hasCommand: async (c) => c !== "rea", exists: () => false }),
  )
  assert.ok(plan.install.some((cmd) => cmd.includes("npm install -g rea-agents")))
  assert.ok(plan.setup.includes("rea setup --client opencode --skill --yes"))
})

test("a missing skill schedules its installer", async () => {
  const plan = await planInstall(
    mcps,
    skills,
    env({ exists: (path) => path !== ".opencode/skills/ui-ux-pro-max/SKILL.md" }),
  )
  assert.ok(plan.install.some((cmd) => cmd.includes("ui-ux-pro-max-cli")))
})

test("remote MCPs never schedule an install", async () => {
  const remote = mcps.filter((m) => m.config(process.env).type === "remote")
  const plan = await planInstall(remote, [], env({ hasCommand: async () => false }))
  assert.deepEqual(plan.install, [])
})

test("install commands keep a stable order for reproducible runs", async () => {
  const plan = await planInstall(
    mcps,
    skills,
    env({ hasCommand: async () => false, exists: () => false }),
  )
  const first = await planInstall(
    mcps,
    skills,
    env({ hasCommand: async () => false, exists: () => false }),
  )
  assert.deepEqual(plan.install, first.install)
})

test("reports which components are missing without running anything", async () => {
  const plan = await planInstall(mcps, skills, env({ exists: () => false }))
  assert.ok(plan.missing.includes("ui-ux-pro-max"))
  assert.ok(plan.missing.includes("design-motion-principles"))
})
