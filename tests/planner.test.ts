import { test } from "node:test"
import assert from "node:assert/strict"

import { planInstall, type Environment } from "../src/planner.ts"
import { isShellWrapper } from "../src/platform.ts"
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

/* --------------------------------------------------------------- Windows */

test("a missing local MCP on Windows schedules the Windows installer", async () => {
  const plan = await planInstall(
    mcps,
    [],
    env({ hasCommand: async (c) => c !== "github-mcp-server" && c !== "rea", exists: () => false }),
    {},
    "win32",
  )

  const github = plan.install.find((cmd) => cmd.includes("github-mcp-server_Windows_x86_64.zip"))
  assert.ok(github, plan.install.join("\n"))
  // The macOS formula has no Windows equivalent; scheduling it would fail with
  // "brew is not recognized" on every provision.
  assert.ok(!plan.install.some((cmd) => cmd.startsWith("brew ")), plan.install.join("\n"))
})

test("a POSIX plan never contains a Windows-only installer", async () => {
  const plan = await planInstall(
    mcps,
    [],
    env({ hasCommand: async (c) => c !== "github-mcp-server", exists: () => false }),
    {},
    "darwin",
  )

  assert.ok(!plan.install.some((cmd) => cmd.includes("github-mcp-server_Windows")), plan.install.join("\n"))
  assert.ok(plan.install.includes("brew install github-mcp-server"), plan.install.join("\n"))
})

test("a component with no installer on this platform is not reported as missing forever", async () => {
  // A manifest entry whose install and setup both resolve to nothing on the
  // host would otherwise send the user to startup_provision on every run.
  const orphan = {
    id: "orphan",
    name: "Orphan",
    repository: "https://github.com/example/orphan",
    install: (platform: string) => (platform === "win32" ? "winget install orphan" : undefined),
    config: () => ({ type: "local" as const, command: ["orphan"] }),
  }

  const plan = await planInstall([orphan], [], env({ hasCommand: async () => false }), {}, "darwin")
  assert.deepEqual(plan.missing, [])
  assert.deepEqual(plan.install, [])
})

test("the same component is provisioned on the platform that supports it", async () => {
  const orphan = {
    id: "orphan",
    name: "Orphan",
    repository: "https://github.com/example/orphan",
    install: (platform: string) => (platform === "win32" ? "winget install orphan" : undefined),
    config: () => ({ type: "local" as const, command: ["orphan"] }),
  }

  const plan = await planInstall([orphan], [], env({ hasCommand: async () => false }), {}, "win32")
  assert.deepEqual(plan.missing, ["orphan"])
  assert.deepEqual(plan.install, ["winget install orphan"])
})

test("REA is verified by its own command, not by probing the shell", async () => {
  const asked: string[] = []
  await planInstall(
    mcps,
    [],
    env({
      hasCommand: async (command) => {
        asked.push(command)
        return true
      },
    }),
    {},
    "win32",
  )

  // `cmd.exe` is on every Windows machine, so probing it would report the
  // server as present even when nothing is installed. `rea --version` is the
  // check that actually answers the question.
  assert.ok(!asked.some((command) => isShellWrapper(command)), asked.join(", "))
  assert.ok(asked.includes("rea"), asked.join(", "))
})
