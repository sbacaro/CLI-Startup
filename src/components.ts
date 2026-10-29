import { existsSync } from "node:fs"
import { homedir } from "node:os"

import { expandHome, runCommand } from "./exec.ts"
import type { UpstreamSkill } from "./manifest.ts"
import type { ComponentStatus } from "./policy.ts"

/** Filesystem and command access, injectable so the probe stays testable. */
export type Probe = {
  exists(path: string): boolean
  version(command: string): Promise<string | undefined>
}

export const realProbe: Probe = {
  exists: (path) => existsSync(expandHome(path, homedir())),
  version: async (command) => {
    const result = await runCommand(`${command} --version`, { timeoutMs: 20_000 })
    if (result.code !== 0) return undefined
    const match = `${result.stdout}${result.stderr}`.match(/\d+\.\d+(?:\.\d+)?/)
    return match?.[0]
  },
}

/**
 * Determines whether an upstream component is installed.
 *
 * Two independent signals matter: the binary on PATH, and the files the
 * installer writes. Checking only the binary would report a freshly upgraded
 * package whose skill was never registered; checking only the files would miss
 * a binary that was removed.
 */
export async function probeComponent(
  skill: UpstreamSkill,
  probe: Probe = realProbe,
): Promise<ComponentStatus> {
  const checksMarkers = skill.markers.length > 0
  const checksBinary = skill.versionCommand !== undefined

  // With neither a marker nor a version command there is nothing to inspect.
  // Reporting "current" would be a guess, so say so instead.
  if (!checksMarkers && !checksBinary) {
    return {
      id: skill.id,
      installed: undefined,
      available: undefined,
      state: "unknown",
      action: skill.update,
    }
  }

  const markerPresent = checksMarkers
    ? skill.markers.some((marker) => probe.exists(marker))
    : true
  const version = checksBinary ? await probe.version(skill.versionCommand!) : undefined
  const binaryPresent = checksBinary ? version !== undefined : true

  const installed = markerPresent && binaryPresent

  return {
    id: skill.id,
    installed: version,
    available: undefined,
    // Present, but nothing here knows the newest release without another network
    // call. "current" means installed, not verified up to date.
    state: installed ? "current" : "missing",
    action: installed ? skill.update : skill.update,
  }
}

export async function probeAll(
  skills: UpstreamSkill[],
  probe: Probe = realProbe,
): Promise<ComponentStatus[]> {
  return Promise.all(skills.map((skill) => probeComponent(skill, probe)))
}
