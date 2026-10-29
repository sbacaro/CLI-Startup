import { Plugin } from "@opencode/plugin"
import type { Context } from "@opencode/plugin/promise/plugin"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"

import { CatalogCache } from "./cache.ts"
import { buildProviderModels, loadCatalog } from "./catalog.ts"
import { discoverModels, type DiscoveredModel } from "./discovery.ts"
import { expandHome, runCommand } from "./exec.ts"
import { mcps, providers, skills, type ProviderSpec } from "./manifest.ts"
import { planInstall, type Environment } from "./planner.ts"
import { UPDATE_POLICY, describeStatus, type ComponentStatus } from "./policy.ts"
import { toModelInfo, toProviderInfo } from "./provision.ts"
import type { MergedModel } from "./resolve.ts"
import { resolveToolchain, toolchainEnvironment, type Probe } from "./toolchain.ts"

const DAY_MS = 24 * 60 * 60 * 1000

type Registration = { dispose(): Promise<void> }

function discoveryKey(providerID: string): string {
  return `discovery/${providerID}`
}

/** The real machine, as the planner sees it. */
const environment: Environment = {
  hasCommand: async (command) => {
    const result = await runCommand(`command -v ${command}`, { timeoutMs: 15_000 })
    return result.code === 0 && result.stdout.trim().length > 0
  },
  exists: (path) => {
    const result = runCommandSync(`test -e "${expandHome(path, homedir())}"`)
    return result === 0
  },
}

/** Short, side-effect-free probes for the local toolchain. */
const toolProbe: Probe = {
  run: (command) => {
    const result = spawnSync(process.env.SHELL || "/bin/sh", ["-lc", command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return { code: result.status ?? 1, stdout: result.stdout ?? "" }
  },
  exists: (path) => {
    return spawnSync(process.env.SHELL || "/bin/sh", ["-c", `test -e "${path}"`], {
      stdio: "ignore",
    }).status === 0
  },
  read: (path) => {
    try {
      return readFileSync(path, "utf8")
    } catch {
      return undefined
    }
  },
  list: (path) => {
    try {
      return readdirSync(path)
    } catch {
      return []
    }
  },
}

function runCommandSync(command: string): number {
  // A synchronous existence check keeps the planner interface simple; `test`
  // returns immediately and never blocks on I/O of any size.
  return spawnSync(process.env.SHELL || "/bin/sh", ["-c", command], { stdio: "ignore" }).status ?? 1
}

/**
 * Reads the credential the user entered in the OpenCode UI.
 *
 * Keys live outside configuration, so the supported way to see one is through
 * the integration the provider declares. The environment fallback keeps a
 * shell-exported key working for people who prefer that.
 */
async function resolveApiKey(ctx: Context, spec: ProviderSpec): Promise<string | undefined> {
  try {
    const connection = await ctx.integration.connection.active(spec.id)
    if (connection) {
      const value = await ctx.integration.connection.resolve(connection)
      if (value && value.type === "key") return value.key
    }
  } catch {
    // No connection yet; fall through to the environment.
  }

  for (const name of spec.env) {
    const fromEnv = process.env[name]
    if (fromEnv) return fromEnv
  }
  return undefined
}

/**
 * The environment handed to REA and the other local servers.
 *
 * The process environment is not enough: an exported `JAVA_HOME=""` makes REA
 * reject every start, and a stale Ghidra path survives a reinstall. The
 * resolver fills both from what is currently on disk.
 */
function localEnvironment(): NodeJS.ProcessEnv {
  const toolchain = resolveToolchain(process.env, toolProbe)
  const resolved = toolchainEnvironment(toolchain)
  const env: NodeJS.ProcessEnv = { ...process.env }

  if (resolved.JAVA_HOME) env.JAVA_HOME = resolved.JAVA_HOME
  else delete env.JAVA_HOME

  if (resolved.GHIDRA_INSTALL_DIR) env.GHIDRA_INSTALL_DIR = resolved.GHIDRA_INSTALL_DIR
  else delete env.GHIDRA_INSTALL_DIR

  return env
}

type ProviderState = {
  spec: ProviderSpec
  models: MergedModel[]
  source: "live" | "cache" | "none"
}

async function loadProviderState(
  ctx: Context,
  spec: ProviderSpec,
  cache: CatalogCache,
): Promise<ProviderState> {
  const catalog = await loadCatalog(cache)
  const apiKey = await resolveApiKey(ctx, spec)
  const result = await discoverModels(spec.baseURL, apiKey)

  if (result.ok) {
    await cache.set(discoveryKey(spec.id), result.models)
    return { spec, models: buildProviderModels(result.models, catalog, spec.id), source: "live" }
  }

  // A gateway that is briefly unreachable must not empty the model picker.
  const cached = await cache.getStale<DiscoveredModel[]>(discoveryKey(spec.id))
  if (Array.isArray(cached) && cached.length > 0) {
    return { spec, models: buildProviderModels(cached, catalog, spec.id), source: "cache" }
  }

  return { spec, models: [], source: "none" }
}

export default Plugin.define({
  id: "opencode-startup",

  async setup(ctx) {
    const cache = new CatalogCache(ctx.storage, DAY_MS)

    // A key-based integration per provider gives the UI somewhere to put a
    // credential, and gives `connection.active` something to find later.
    await ctx.integration.transform((editor) => {
      for (const spec of providers) {
        if (editor.get(spec.id)) continue
        editor.update(spec.id, (integration) => {
          integration.name = spec.name
        })
        editor.method.update({
          integrationID: spec.id,
          method: { type: "key", label: spec.credentialLabel },
        })
      }
    })

    // MCP servers are declared as data, so re-provisioning is idempotent and a
    // server the user configured by hand is left untouched.
    await ctx.mcp.transform((editor) => {
      const env = localEnvironment()
      for (const mcp of mcps) {
        if (editor.get(mcp.id)) continue
        editor.set(mcp.id, mcp.config(env) as never)
      }
    })

    let disposed = false
    let active: Registration | undefined

    /**
     * Publishes the provider inventory.
     *
     * The transform is registered only once discovery has finished, and the
     * previous registration is disposed first. A provider added by an earlier
     * transform does not pick up a `models.set` from a later one, so the
     * inventory has to arrive with the provider itself.
     */
    const publish = async () => {
      const states = await Promise.all(providers.map((spec) => loadProviderState(ctx, spec, cache)))
      if (disposed) return

      await active?.dispose()

      active = await ctx.provider.transform((editor) => {
        for (const state of states) {
          const info = toProviderInfo(state.spec)
          const models = state.models.map((model) => toModelInfo(model, state.spec.id))

          if (editor.get(state.spec.id)) editor.remove(state.spec.id)
          editor.add({ info, models })
        }
      })

      await ctx.provider.reload()
    }

    await publish().catch((error) => {
      console.warn(
        `[startup] provider publish failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })

    // A key pasted into the UI arrives as a credential event. Republishing here
    // is what makes the model list appear without restarting OpenCode.
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: ["credential.updated", "credential.switched"],
          signal: controller.signal,
        })) {
          void event
          await publish().catch(() => {})
        }
      } catch {
        // The subscription ends when the plugin unloads.
      }
    })()

    await ctx.session.hook("context", (event) => {
      event.system.push({ type: "text", text: UPDATE_POLICY })
    })

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "startup",
        description: "Provision and keep this OpenCode installation current.",
      })

      editor.add({
        name: "status",
        description:
          "Report MCP servers, skills, and providers, marking anything missing on this machine.",
        input: { type: "object", additionalProperties: false },
        options: { namespace: "startup", codemode: true },
        execute: async () => {
          const plan = await planInstall(mcps, skills, environment)
          const components: ComponentStatus[] = [
            ...mcps.map((mcp) => ({
              id: mcp.id,
              installed: plan.missing.includes(mcp.id) ? undefined : "present",
              available: undefined,
              state: plan.missing.includes(mcp.id) ? ("missing" as const) : ("current" as const),
              action: mcp.setup ?? mcp.update ?? mcp.install,
            })),
            ...skills.map((skill) => ({
              id: skill.id,
              installed: plan.missing.includes(skill.id) ? undefined : "present",
              available: undefined,
              state: plan.missing.includes(skill.id) ? ("missing" as const) : ("current" as const),
              action: skill.update,
            })),
          ]
          return { content: describeStatus(components) }
        },
      })

      editor.add({
        name: "provision",
        description:
          "Install everything that is missing, using each project's own installer. Idempotent: an already provisioned machine runs nothing.",
        input: {
          type: "object",
          properties: {
            dryRun: { type: "boolean", description: "Report the commands without running them." },
          },
          additionalProperties: false,
        },
        options: { namespace: "startup", codemode: true },
        execute: async (input, context) => {
          const { dryRun } = (input ?? {}) as { dryRun?: boolean }
          const plan = await planInstall(mcps, skills, environment)

          if (plan.install.length === 0 && plan.setup.length === 0) {
            return { content: "Everything is already provisioned." }
          }
          if (dryRun) {
            return {
              content: [...plan.install, ...plan.setup].map((cmd) => `would run: ${cmd}`).join("\n"),
            }
          }

          const lines: string[] = []
          for (const command of [...plan.install, ...plan.setup]) {
            await context.progress({ status: command })
            const result = await runCommand(command, { signal: context.signal })
            const tail = `${result.stdout}${result.stderr}`.trim().split("\n").slice(-2).join("\n")
            lines.push(`${result.code === 0 ? "ok  " : `fail`} ${command}`)
            if (result.code !== 0 && tail) lines.push(tail)
          }

          // Newly installed MCP prerequisites may need the server list rebuilt.
          await ctx.mcp.reload()
          return { content: lines.join("\n") }
        },
      })

      editor.add({
        name: "update",
        description: "Update every component through its own upstream command.",
        input: {
          type: "object",
          properties: {
            component: { type: "string", description: "Component id, or 'all'." },
          },
          required: ["component"],
          additionalProperties: false,
        },
        options: { namespace: "startup", codemode: true },
        execute: async (input, context) => {
          const { component } = input as { component: string }
          const targets = [
            ...mcps.filter((m) => m.update).map((m) => ({ id: m.id, update: m.update! })),
            ...skills.map((s) => ({ id: s.id, update: s.update })),
          ].filter((t) => component === "all" || t.id === component)

          if (targets.length === 0) {
            const known = [...mcps.map((m) => m.id), ...skills.map((s) => s.id)]
            return { content: `Unknown component: ${component}. Known: ${known.join(", ")}` }
          }

          const lines: string[] = []
          for (const target of targets) {
            await context.progress({ status: `updating ${target.id}` })
            const result = await runCommand(target.update, { signal: context.signal })
            lines.push(`${target.id}: ${result.code === 0 ? "ok" : `failed (${result.code})`}`)
          }
          return { content: lines.join("\n") }
        },
      })
    })

    return async () => {
      disposed = true
      controller.abort()
      await active?.dispose()
    }
  },
})
