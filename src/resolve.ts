/**
 * Matches a gateway's model id against the models.dev catalog.
 *
 * Gateways resell models under their own ids: some keep the vendor prefix
 * (`anthropic/claude-opus-5-5`), some drop it (`claude-opus-5`), some change
 * the spelling (`Claude Opus 5.5`, `MiniMax-M2.7`). A global id scan picks the
 * wrong owner because resellers list the same model, so every lookup is
 * anchored to the model's canonical vendor first.
 */

export type CatalogModel = {
  id?: string
  name?: string
  family?: string
  cost?: {
    input?: number
    output?: number
    cache_read?: number
    cache_write?: number
    context_over_200k?: {
      input?: number
      output?: number
      cache_read?: number
      cache_write?: number
    }
    tiers?: Array<{
      input?: number
      output?: number
      cache_read?: number
      cache_write?: number
      tier?: { type?: string; size?: number }
    }>
  }
  limit?: { context?: number; output?: number }
  modalities?: { input?: string[]; output?: string[] }
  reasoning?: boolean
  tool_call?: boolean
}

export type Catalog = Record<string, { models?: Record<string, CatalogModel> }>

export type CatalogHit = {
  provider: string
  modelId: string
  model: CatalogModel
}

/** Vendor prefixes that gateways put in front of a model id. */
const VENDOR_PREFIX: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  vertex_ai: "google",
  vertex: "google",
  gemini: "google",
  xai: "xai",
  minimax: "minimax",
  zhipuai: "zhipuai",
  alibaba: "alibaba",
  moonshotai: "moonshotai",
}

/** Name prefixes that identify a model's vendor when no prefix is present. */
const NAME_FAMILY: Array<[RegExp, string]> = [
  [/^claude/i, "anthropic"],
  [/^gpt/i, "openai"],
  [/^o[13][-_]/i, "openai"],
  [/^gemini/i, "google"],
  [/^glm/i, "zhipuai"],
  [/^grok/i, "xai"],
  [/^minimax/i, "minimax"],
  [/^qwen/i, "alibaba"],
  [/^kimi/i, "moonshotai"],
  [new RegExp("^" + "deepseek", "i"), "deepseek"],
]

/**
 * Folds the spellings a gateway may choose into one comparable key:
 * case, spaces, and dot-versus-dash separators all collapse.
 */
export function normalizeId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[.\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function bareId(gatewayId: string): string {
  const parts = gatewayId.split("/")
  return parts[parts.length - 1]
}

/** The models.dev provider that canonically owns this model, if identifiable. */
export function canonicalProvider(gatewayId: string): string | undefined {
  const parts = gatewayId.split("/")
  if (parts.length > 1) {
    const mapped = VENDOR_PREFIX[parts[0].toLowerCase()]
    if (mapped) return mapped
  }
  const bare = bareId(gatewayId)
  for (const [pattern, provider] of NAME_FAMILY) {
    if (pattern.test(bare)) return provider
  }
  return undefined
}

function indexProvider(catalog: Catalog, provider: string): Map<string, string> | undefined {
  const entry = catalog[provider]
  if (!entry?.models) return undefined
  const index = new Map<string, string>()
  for (const modelId of Object.keys(entry.models)) {
    index.set(normalizeId(modelId), modelId)
  }
  return index
}

export type ResolveOptions = {
  /** The gateway's own id, used to strip a trailing vendor-name suffix. */
  providerName?: string
}

/**
 * Resolves a gateway id to a catalog entry.
 *
 * Order matters: an exact normalized match wins, then a spelling that drops or
 * repeats the gateway's own name. Anything left is genuinely gateway-specific
 * (internal aliases, preview channels) and returns undefined.
 */
export function resolveCatalogEntry(
  gatewayId: string,
  catalog: Catalog,
  options: ResolveOptions = {},
): CatalogHit | undefined {
  const provider = canonicalProvider(gatewayId)
  if (!provider) return undefined

  const index = indexProvider(catalog, provider)
  const models = catalog[provider]?.models
  if (!index || !models) return undefined

  const bare = bareId(gatewayId)
  const candidates = [bare]

  // `claude-opus-5-kodeo` is the same model with the gateway name appended.
  const suffixes = new Set<string>()
  if (options.providerName) suffixes.add(options.providerName)
  const vendorSegment = gatewayId.split("/")[0]
  if (gatewayId.includes("/")) suffixes.add(vendorSegment)

  for (const suffix of suffixes) {
    const lowered = bare.toLowerCase()
    const tail = `-${suffix.toLowerCase()}`
    if (lowered.endsWith(tail)) {
      candidates.push(bare.slice(0, bare.length - tail.length))
    }
  }

  for (const candidate of candidates) {
    const key = normalizeId(candidate)
    const modelId = index.get(key)
    if (modelId) return { provider, modelId, model: models[modelId] }
  }

  return undefined
}

export type GatewayModel = {
  id: string
  name: string
  context: number
  output: number
  input: string[]
  reasoning: boolean
  tools: boolean
}

export type MergedModel = GatewayModel & {
  cost?: {
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
    over?: {
      size: number
      input: number
      output: number
      cacheRead?: number
      cacheWrite?: number
    }
  }
}

function pricingTier(cost: NonNullable<CatalogModel["cost"]>): MergedModel["cost"] | undefined {
  if (typeof cost.input !== "number" || typeof cost.output !== "number") return undefined

  const base: NonNullable<MergedModel["cost"]> = {
    input: cost.input,
    output: cost.output,
    cacheRead: cost.cache_read,
    cacheWrite: cost.cache_write,
  }

  const over = cost.context_over_200k
  const tier = cost.tiers?.find((t) => t.tier?.type === "context")

  if (over && typeof over.input === "number" && typeof over.output === "number") {
    base.over = {
      size: tier?.tier?.size ?? 200_000,
      input: over.input,
      output: over.output,
      cacheRead: over.cache_read,
      cacheWrite: over.cache_write,
    }
  } else if (tier && typeof tier.tier?.size === "number") {
    base.over = {
      size: tier.tier.size,
      input: tier.input ?? cost.input,
      output: tier.output ?? cost.output,
      cacheRead: tier.cache_read,
      cacheWrite: tier.cache_write,
    }
  }

  return base
}

/**
 * Combines the two sources by authority: the gateway owns what it serves
 * (identity and limits), the catalog owns economics (what a token costs).
 */
export function mergeModel(gateway: GatewayModel, hit: CatalogHit | undefined): MergedModel {
  const merged: MergedModel = { ...gateway }
  if (!hit?.model.cost) return merged

  const cost = pricingTier(hit.model.cost)
  if (cost) merged.cost = cost
  return merged
}
