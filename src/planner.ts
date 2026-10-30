/**
 * Turns the desired state into the smallest set of actions that reaches it.
 *
 * The planner is pure: it inspects the machine through an injected
 * `Environment` and returns commands to run. That keeps the decision — what is
 * missing and what would fix it — testable without touching the network, the
 * filesystem, or the user's installation.
 */

import { commandFor, type McpSpec, type SkillSpec } from "./manifest.ts"
import { hostPlatform, isShellWrapper, type PlatformID } from "./platform.ts"

export type Environment = {
  /** Whether an executable resolves on PATH. */
  hasCommand(command: string): Promise<boolean>
  /** Whether a path exists, with a leading `~` already expanded. */
  exists(path: string): boolean
}

export type InstallPlan = {
  /** Commands to run, in a stable order. */
  install: string[]
  /** Component setup commands, after prerequisites have been installed. */
  setup: string[]
  /** Component ids that are not yet provisioned. */
  missing: string[]
}

/** The executable a command string invokes, for PATH probing. */
export function commandName(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? ""
  return first.replace(/^"|"$/g, "")
}

async function mcpMissing(
  mcp: McpSpec,
  env: Environment,
  processEnv: NodeJS.ProcessEnv,
  platform: PlatformID,
): Promise<{ prerequisite: boolean; setup: boolean }> {
  const config = mcp.config(processEnv, platform)
  if (config.type !== "local") return { prerequisite: false, setup: false }

  let prerequisite = false

  // The declared command is what OpenCode will spawn; if it does not resolve,
  // the server cannot start no matter what the installer claims. A shell
  // wrapper says nothing here — the shell is always installed, and the server
  // it launches is covered by `verify` instead.
  const declared = config.command
  if (Array.isArray(declared) && typeof declared[0] === "string" && !isShellWrapper(declared[0])) {
    if (!(await env.hasCommand(declared[0]))) prerequisite = true
  }

  if (mcp.verify && !(await env.hasCommand(commandName(mcp.verify.command)))) prerequisite = true

  const setup = mcp.setupMarkers?.some((marker) => !env.exists(marker)) ?? false

  return { prerequisite, setup }
}

function skillMissing(skill: SkillSpec, env: Environment): boolean {
  // A skill registered through a plugin has no file to probe.
  if (skill.markers.length === 0) return false
  return !skill.markers.some((marker) => env.exists(marker))
}

/**
 * Builds the install plan. Remote MCPs need nothing on disk; local ones need
 * their executable; skills need the files their installer writes.
 *
 * A component whose installer has no form on this platform is never scheduled:
 * the plan is a list of things that will work, not a wish list.
 */
export async function planInstall(
  mcps: McpSpec[],
  skills: SkillSpec[],
  env: Environment,
  processEnv: NodeJS.ProcessEnv = process.env,
  platform: PlatformID = hostPlatform(),
): Promise<InstallPlan> {
  const install: string[] = []
  const setup: string[] = []
  const missing: string[] = []

  for (const mcp of mcps) {
    const state = await mcpMissing(mcp, env, processEnv, platform)
    if (!state.prerequisite && !state.setup) continue

    const installCommand = state.prerequisite ? commandFor(mcp.install ?? "", platform) : undefined
    const setupCommand = state.setup ? commandFor(mcp.setup ?? "", platform) : undefined
    const installable = Boolean(installCommand)
    const registered = Boolean(setupCommand)

    // Nothing this platform can do about it: reporting it as missing would send
    // the user to `startup_provision` forever.
    if (!installable && !registered) continue

    missing.push(mcp.id)
    if (installCommand) install.push(installCommand)
    if (setupCommand) setup.push(setupCommand)
  }

  for (const skill of skills) {
    if (skillMissing(skill, env)) {
      const installCommand = commandFor(skill.install, platform)
      if (!installCommand) continue
      missing.push(skill.id)
      install.push(installCommand)
    }
  }

  return { install, setup, missing }
}