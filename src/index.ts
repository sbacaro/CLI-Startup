import { Plugin } from "@opencode/plugin"
import type { Context } from "@opencode/plugin/promise/plugin"

import { CatalogCache } from "./cache.ts"
import { buildProviderModels, loadCatalog } from "./catalog.ts"
import { probeAll } from "./components.ts"
import { discoverModels, type DiscoveredModel } from "./discovery.ts"
import { runCommand } from "./exec.ts"
import { providers, skills, type ProviderSpec } from "./manifest.ts"
import { UPDATE_POLICY, describeStatus, type ComponentStatus } from "./policy.ts"
import { toModelInfo, toProviderInfo } from "./provision.ts"
import type { MergedModel } from "./resolve.ts"

const DAY_MS = 24 * 60 * 60 * 1000

function discoveryKey(providerID: string): string {
  return `discovery/${providerID}`
}

type Registration = { dispose(): Promise<void> }

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

    let disposed = false
    let active: Registration | undefined

    /**
     * Publishes the current inventory.
     *
     * The transform is registered only once discovery has finished. Registering
     * an empty provider first and patching models in later does not work: a
     * provider added by an earlier transform does not pick up a `models.set`
     * from a later one. Disposing the previous registration also keeps repeated
     * refreshes from stacking transforms.
     */
    const publish = async () => {
      const states = await Promise.all(providers.map((spec) => loadProviderState(ctx, spec, cache)))
      if (disposed) return

      await active?.dispose()

      active = await ctx.provider.transform((editor) => {
        for (const state of states) {
          const info = toProviderInfo(state.spec)
          const models = state.models.map((model) => toModelInfo(model, state.spec.id))

          if (editor.get(state.spec.id)) {
            editor.remove(state.spec.id)
          }
          editor.add({ info, models })
        }
      })

      await ctx.provider.reload()
    }

    // Await the first publish so the picker is populated before the first
    // request, rather than racing it.
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
        description: "Keep this OpenCode installation and its third-party skills current.",
      })

      editor.add({
        name: "status",
        description:
          "Report every component this installation tracks, with its installed and available version.",
        input: { type: "object", additionalProperties: false },
        options: { namespace: "startup", codemode: true },
        execute: async () => {
          const components = await probeAll(skills)
          return { content: describeStatus(components) }
        },
      })

      editor.add({
        name: "update",
        description:
          "Update one component by id using its upstream installer, or pass 'all' for every component.",
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
          const targets = component === "all" ? skills : skills.filter((s) => s.id === component)

          if (targets.length === 0) {
            return {
              content: `Unknown component: ${component}. Known: ${skills.map((s) => s.id).join(", ")}`,
            }
          }

          // Each installer is the upstream project's own command, run verbatim.
          // A failure on one component must not stop the others.
          const lines: string[] = []
          for (const target of targets) {
            await context.progress({ status: `updating ${target.id}` })
            const result = await runCommand(target.update, { signal: context.signal })
            const tail = `${result.stdout}${result.stderr}`.trim().split("\n").slice(-3).join("\n")
            lines.push(`${target.id}: ${result.code === 0 ? "ok" : `failed (${result.code})`}`)
            if (tail) lines.push(tail)
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
