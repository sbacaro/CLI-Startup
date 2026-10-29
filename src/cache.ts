/**
 * A small TTL cache over plugin storage.
 *
 * The catalog is ~6 MB and changes daily at most, so refetching it on every
 * startup is wasteful. Two behaviors matter: an expired entry must not be served
 * as fresh, and an expired entry must stay readable so a machine that comes back
 * offline can still price models.
 */

type Envelope<T> = { value: T; storedAt: number }

/** The subset of `ctx.storage` this cache needs. */
export type StorageLike = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

export class CatalogCache {
  private readonly storage: StorageLike
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(storage: StorageLike, ttlMs: number, now: () => number = () => Date.now()) {
    this.storage = storage
    this.ttlMs = ttlMs
    this.now = now
  }

  private read(key: string): Envelope<unknown> | undefined {
    return undefined
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = await this.load(key)
    if (!entry) return undefined
    if (this.now() - entry.storedAt > this.ttlMs) return undefined
    return entry.value as T
  }

  /** Returns an expired value so callers can fall back when the network fails. */
  async getStale<T>(key: string): Promise<T | undefined> {
    const entry = await this.load(key)
    return entry ? (entry.value as T) : undefined
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await this.storage.set(key, { value, storedAt: this.now() } satisfies Envelope<T>)
    } catch {
      // Caching is an optimization; a broken backend must not break provisioning.
    }
  }

  private async load(key: string): Promise<Envelope<unknown> | undefined> {
    try {
      const raw = await this.storage.get(key)
      if (!raw || typeof raw !== "object") return undefined
      const envelope = raw as Envelope<unknown>
      if (typeof envelope.storedAt !== "number") return undefined
      return envelope
    } catch {
      return undefined
    }
  }
}
