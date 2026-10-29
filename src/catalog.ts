/**
 * Builds a provider's model list from two sources, each authoritative for what
 * it actually knows:
 *
 *   1. The gateway's `/v1/models` — what is served right now, with real limits.
 *   2. models.dev — what a token costs, plus cache and long-context tiers.
 *
 * Nothing is hardcoded, so a model added by the gateway tomorrow appears without
 * a plugin release. Models that neither source can price keep gateway metadata
 * and report cost as unknown rather than inventing a number.
 */

import { CatalogCache } from "./cache.ts"
import type { DiscoveredModel } from "./discovery.ts"
import { mergeModel, resolveCatalogEntry, type Catalog, type MergedModel } from "./resolve.ts"

export const CATALOG_URL = "https://models.dev/api.json"
export const CATALOG_CACHE_KEY = "catalog/modelsdev"
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Loads the catalog, preferring a fresh cache, then the network, then a stale
 * cache. A catalog failure degrades pricing; it never blocks provisioning.
 */
export async function loadCatalog(
  cache: CatalogCache,
  fetchImpl: typeof fetch = fetch,
): Promise<Catalog> {
  const fresh = await cache.get<Catalog>(CATALOG_CACHE_KEY)
  if (fresh) return fresh

  try {
    const response = await fetchImpl(CATALOG_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    })
    if (response.ok) {
      const catalog = (await response.json()) as Catalog
      await cache.set(CATALOG_CACHE_KEY, catalog)
      return catalog
    }
  } catch {
    // Fall through to the stale copy.
  }

  const stale = await cache.getStale<Catalog>(CATALOG_CACHE_KEY)
  return stale ?? {}
}

/**
 * Merges a gateway's models with catalog pricing. Order follows the gateway so
 * the model picker stays stable across refreshes.
 */
export function buildProviderModels(
  gatewayModels: DiscoveredModel[],
  catalog: Catalog,
  providerName: string,
): MergedModel[] {
  return gatewayModels.map((model) => {
    const hit = resolveCatalogEntry(model.id, catalog, { providerName })
    return mergeModel(model, hit)
  })
}
