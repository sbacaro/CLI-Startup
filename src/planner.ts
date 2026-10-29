/**
 * Turns the desired state into the smallest set of actions that reaches it.
 *
 * The planner is pure: it inspects the machine through an injected
 * `Environment` and returns commands to run. That keeps the decision — what is
 * missing and what would fix it — testable without touching the network, the
 * filesystem, or the user's installation.
 */

import type { McpSpec, SkillSpec } from "./manifest.ts"

export type Environment = {
  /** Whether an executable resolves on PATH. */
  hasCommand(command: string): Promise<boolean>
  /** Whether a path exists, with a leading `~` already expanded. */
  exists(path: string): boolean
}

export type InstallPlan = {
  /** Commands to run, in a stable order. */
  install: string[]
  /** Component ids that are not yet provisioned. */
  missing: string[]
}

/** The executable a command string invokes, for PATH probing. */
export function commandName(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? ""
  return first
}

async function mcpMissing(mcp: McpSpec, env: Environment, processEnv: NodeJS.ProcessEnv): Promise<boolean> {
  const config = mcp.config(processEnv)
  if (config.type !== "local") return false
  if (!mcp.install) return false

  // The declared command is what OpenCode will spawn; if it does not resolve,
  // the server cannot start no matter what the installer claims.
  const declared = config.command
  if (Array.isArray(declared) && typeof declared[0] === "string") {
    if (!(await env.hasCommand(declared[0]))) return true
  }

  if (mcp.verify) {
    return !(await env.hasCommand(commandName(mcp.verify.command)))
  }

  return false
}

function skillMissing(skill: SkillSpec, env: Environment): boolean {
  // A skill registered through a plugin has no file to probe.
  if (skill.markers.length === 0) return false
  return !skill.markers.some((marker) => env.exists(marker))
}

/**
 * Builds the install plan. Remote MCPs need nothing on disk; local ones need
 * their executable; skills need the files their installer writes.
 */
export async function planInstall(
  mcps: McpSpec[],
  skills: SkillSpec[],
  env: Environment,
  processEnv: NodeJS.ProcessEnv = process.env,
): Promise<InstallPlan> {
  const install: string[] = []
  const missing: string[] = []

  for (const mcp of mcps) {
    if (await mcpMissing(mcp, env, processEnv)) {
      missing.push(mcp.id)
      if (mcp.install) install.push(mcp.install)
    }
  }

  for (const skill of skills) {
    if (skillMissing(skill, env)) {
      missing.push(skill.id)
      install.push(skill.install)
    }
  }

  return { install, missing }
}
