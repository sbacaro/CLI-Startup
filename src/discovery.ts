/**
 * Discovers a provider's model catalog from its own OpenAI-compatible
 * `/v1/models` endpoint.
 *
 * The catalog is never hardcoded. Gateways add, rename, and retire models far
 * more often than this plugin is republished, so the only durable source is the
 * endpoint itself.
 */

export type DiscoveredModel = {
  id: string
  name: string
  context: number
  output: number
  input: string[]
  reasoning: boolean
  tools: boolean
}

type RawCapabilities = {
  image_input?: { supported?: boolean }
  pdf_input?: { supported?: boolean }
  thinking?: { supported?: boolean }
}

export type RawModel = {
  id?: string
  display_name?: string
  context_length?: number
  max_input_tokens?: number
  max_tokens?: number
  capabilities?: RawCapabilities
  supported_parameters?: string[]
}

export type ModelsPayload = { data?: RawModel[] }

export type DiscoveryResult =
  | { ok: true; models: DiscoveredModel[] }
  | { ok: false; reason: "no-credential" | "unauthorized" | "unreachable"; message: string }

const DEFAULT_CONTEXT = 128_000
const DEFAULT_OUTPUT = 32_000

function mediaTypes(capabilities: RawCapabilities | undefined): string[] {
  const input = ["text"]
  if (capabilities?.image_input?.supported) input.push("image")
  if (capabilities?.pdf_input?.supported) input.push("pdf")
  return input
}

function normalize(raw: RawModel): DiscoveredModel | undefined {
  if (!raw.id) return undefined
  return {
    id: raw.id,
    name: raw.display_name ?? raw.id,
    context: raw.max_input_tokens ?? raw.context_length ?? DEFAULT_CONTEXT,
    output: raw.max_tokens ?? DEFAULT_OUTPUT,
    input: mediaTypes(raw.capabilities),
    reasoning: raw.capabilities?.thinking?.supported ?? true,
    tools: raw.supported_parameters?.includes("tools") ?? true,
  }
}

/**
 * Turns a `/v1/models` payload into gateway models. Exported separately from the
 * fetch so the mapping is testable without a network call, and so a cached
 * payload can be re-normalized without refetching.
 */
export function normalizeGatewayPayload(payload: unknown): DiscoveredModel[] {
  const body = payload as ModelsPayload | null | undefined
  const data = Array.isArray(body?.data) ? body.data : []
  return data.map(normalize).filter((m): m is DiscoveredModel => m !== undefined)
}

/**
 * Fetches the catalog. A missing credential is a normal, expected state — it is
 * what the user sees before pasting a key into the UI — so it returns a typed
 * reason instead of throwing.
 */
export async function discoverModels(
  baseURL: string,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<DiscoveryResult> {
  if (!apiKey) {
    return {
      ok: false,
      reason: "no-credential",
      message: "No API key yet. Add one in the OpenCode UI to load models.",
    }
  }

  let response: Response
  try {
    response = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: signal ?? AbortSignal.timeout(20_000),
    })
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      message: error instanceof Error ? error.message : String(error),
    }
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "unauthorized", message: "The API key was rejected." }
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: "unreachable",
      message: `${response.status} ${response.statusText}`,
    }
  }

  let body: ModelsPayload
  try {
    body = (await response.json()) as ModelsPayload
  } catch {
    return { ok: false, reason: "unreachable", message: "Response was not JSON." }
  }

  return { ok: true, models: normalizeGatewayPayload(body) }
}
