/**
 * Converts discovered + priced models into the SDK's canonical shapes.
 *
 * The SDK brands identity and money values, and fills defaults the runtime
 * requires (`enabled`, `variants`, `time`, `status`). Building through the
 * provided constructors keeps this file honest against those contracts instead
 * of guessing at the object shape.
 */

import { Integration, Model, Provider } from "@opencode/plugin"
import { Money } from "@opencode/schema/money"

import type { ProviderSpec } from "./manifest.ts"
import type { MergedModel } from "./resolve.ts"

export function toProviderInfo(spec: ProviderSpec): Provider.Info {
  const base = Provider.Info.empty(Provider.ID.make(spec.id))
  return {
    ...base,
    name: spec.name,
    // Enabled rather than "auto": a provider with no credential must still be
    // visible, otherwise the picker offers no place to enter a key.
    activation: "enabled",
    package: "@opencode/ai/providers/openai-compatible",
    // Binds the provider to the integration that holds its API key, so a key
    // entered in the UI reaches this provider.
    integrationID: Integration.ID.make(spec.id),
    settings: {
      ...base.settings,
      baseURL: spec.baseURL,
    },
  }
}

export function toModelInfo(model: MergedModel, providerID: string): Model.Info {
  const provider = Provider.ID.make(providerID)
  const base = Model.Info.default(provider, Model.ID.make(model.id))

  const price = Money.USDPerMillionTokens.make

  const tiers: Model.Info["cost"] = model.cost
    ? [
        {
          input: price(model.cost.input),
          output: price(model.cost.output),
          cache: {
            read: price(model.cost.cacheRead ?? 0),
            write: price(model.cost.cacheWrite ?? 0),
          },
        },
        ...(model.cost.over
          ? [
              {
                input: price(model.cost.over.input),
                output: price(model.cost.over.output),
                cache: {
                  read: price(model.cost.over.cacheRead ?? 0),
                  write: price(model.cost.over.cacheWrite ?? 0),
                },
                tier: { type: "context" as const, size: model.cost.over.size },
              },
            ]
          : []),
      ]
    : []

  return {
    ...base,
    name: model.name,
    limit: { context: model.context, output: model.output },
    capabilities: {
      ...base.capabilities,
      tools: model.tools,
      input: model.input,
      output: ["text"],
    },
    cost: tiers,
  }
}
