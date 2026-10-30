/**
 * Finds the Ghidra installation and the JDK that REA needs.
 *
 * REA does not install either one, and it rejects a relative or empty
 * `JAVA_HOME` outright. A machine can therefore look provisioned while every
 * REA start fails: the variable exists, but it is blank or points at a folder
 * that was deleted. Resolving both here, from what is actually on disk, keeps
 * that failure out of the MCP registration.
 *
 * Where a tool lands depends on the platform — Homebrew prefixes on macOS, a
 * `winget` install under `%ProgramFiles%` on Windows — so the search is written
 * per platform instead of pretending one layout covers both.
 */

import { hostPlatform, pathSeparator, type PlatformID } from "./platform.ts"

/** The machine, as the resolver sees it. Injected so the rules stay testable. */
export type Probe = {
  /** Runs a short command and returns its exit code and stdout. */
  run(command: string): { code: number; stdout: string }
  exists(path: string): boolean
  read(path: string): string | undefined
  /** Lists direct child names of a directory. */
  list(path: string): string[]
}

export type Toolchain = {
  /** Root of an extracted Ghidra release, the folder holding `Ghidra/`. */
  ghidraHome?: string
  /** A 64-bit full JDK whose `bin/javac` exists. */
  javaHome?: string
}

const GHIDRA_DIR = "Ghidra"
const GHIDRA_PROPERTIES_FILE = "application.properties"

/** REA 6.8.0 currently verifies the 12.1 line (including 12.1.4). */
export function supportedGhidra(version: string): boolean {
  return /^12\.1(?:\.\d+)?$/.test(version)
}

function join(platform: PlatformID, ...parts: string[]): string {
  const separator = pathSeparator(platform)
  return parts
    .filter((part) => part.length > 0)
    .map((part, index) => (index === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join(separator)
}

/** A value usable as a path: present and absolute. REA rejects everything else. */
function absolutePath(value: string | undefined, platform: PlatformID = hostPlatform()): string | undefined {
  if (!value) return undefined
  // Windows accepts a drive-letter or UNC root; POSIX accepts a single root.
  // Backslashes are only a separator on Windows, so a POSIX path keeps them.
  const absolute =
    platform === "win32" ? /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) : value.startsWith("/")
  if (!absolute) return undefined
  return value.replace(/[\\/]+$/, "")
}

function javacIn(platform: PlatformID, home: string): string {
  return join(platform, home, "bin", platform === "win32" ? "javac.exe" : "javac")
}

/* ------------------------------------------------------------------ macOS */

/** A Homebrew prefix, or undefined when the formula is not installed. */
function brewPrefix(probe: Probe, formula: string): string | undefined {
  const result = probe.run(`brew --prefix ${formula}`)
  if (result.code !== 0) return undefined
  return absolutePath(result.stdout.trim(), "darwin")
}

/** The JDK home inside a keg-only Homebrew formula. */
function brewJavaHome(prefix: string): string {
  return `${prefix}/libexec/openjdk.jdk/Contents/Home`
}

/** Whether `path` holds an extracted Ghidra release. */
function isGhidra(probe: Probe, platform: PlatformID, path: string): boolean {
  return probe.exists(propertiesPath(platform, path))
}

function propertiesPath(platform: PlatformID, ghidraRoot: string): string {
  return join(platform, ghidraRoot, GHIDRA_DIR, GHIDRA_PROPERTIES_FILE)
}

function ghidraVersion(probe: Probe, platform: PlatformID, path: string): string | undefined {
  const text = probe.read(propertiesPath(platform, path))
  return /^application\.version\s*=\s*(\S+)/m.exec(text ?? "")?.[1]
}

/**
 * The Java release Ghidra declares, read from its own properties file.
 *
 * Current Ghidra 12.1 builds want 21 and 12.2 wants 25, so the version is read
 * rather than hardcoded: a hardcoded JDK is how a working install breaks on the
 * next Ghidra release.
 */
function declaredJava(probe: Probe, platform: PlatformID, ghidraHome: string | undefined): string | undefined {
  if (!ghidraHome) return undefined
  const text = probe.read(propertiesPath(platform, ghidraHome))
  if (!text) return undefined
  const match = /^application\.java\.min\s*=\s*(\d+)/m.exec(text)
  return match?.[1]
}

/* ---------------------------------------------------------------- Windows */

function windowsRoots(env: NodeJS.ProcessEnv, home: string | undefined): string[] {
  const roots = [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.ProgramW6432,
    env.LOCALAPPDATA ? join("win32", env.LOCALAPPDATA, "Programs") : undefined,
    home,
  ]
  return roots.filter((root): root is string => Boolean(root))
}

/**
 * Directories an extractor plausibly used.
 *
 * Explorer's "Extract All" defaults to a folder next to the zip in Downloads,
 * so a release a user unzipped by hand is normally one of these and not on PATH.
 */
function windowsScanDirs(env: NodeJS.ProcessEnv, home: string | undefined): string[] {
  return [...(home ? [home, join("win32", home, "Downloads"), join("win32", home, "Desktop")] : []), ...windowsRoots(env, home)]
}

/** Ghidra release folders under a scan directory, newest name order preserved. */
function windowsGhidraCandidates(probe: Probe, env: NodeJS.ProcessEnv, home: string | undefined): string[] {
  const candidates: string[] = []
  for (const directory of windowsScanDirs(env, home)) {
    for (const name of probe.list(directory)) {
      if (!/^ghidra_.*_PUBLIC$/i.test(name)) continue
      const path = join("win32", directory, name)
      if (!candidates.includes(path)) candidates.push(path)
    }
  }
  return candidates
}

/**
 * The JDK home inside a Windows install directory.
 *
 * Adoptium, Oracle, and Microsoft all lay a JDK out the same way but under
 * different vendor folders, and the folder name carries the version, so the
 * declared major is matched against the directory name before probing `javac`.
 */
function windowsJavaCandidates(probe: Probe, env: NodeJS.ProcessEnv, version: string): string[] {
  const vendors = [
    env.ProgramFiles && join("win32", env.ProgramFiles, "Eclipse Adoptium"),
    env.ProgramFiles && join("win32", env.ProgramFiles, "Java"),
    env.ProgramFiles && join("win32", env.ProgramFiles, "Microsoft"),
    env.ProgramFiles && join("win32", env.ProgramFiles, "Zulu"),
    env.ProgramFiles && join("win32", env.ProgramFiles, "Amazon Corretto"),
    env.LOCALAPPDATA && join("win32", env.LOCALAPPDATA, "Programs", "Eclipse Adoptium"),
  ].filter((vendor): vendor is string => Boolean(vendor))

  const candidates: string[] = []
  const pattern = new RegExp(`(?:jdk|jdk-|java-|corretto-|zulu-)?${version}(?:[.\\-_].*)?$`, "i")
  for (const vendor of vendors) {
    for (const name of probe.list(vendor)) {
      // `jdk-21.0.5.11-hotspot`, `jdk-21`, `java-21-openjdk`: the major version
      // has to appear as its own number, not as a prefix of a longer one.
      if (!pattern.test(name)) continue
      const home = join("win32", vendor, name)
      if (probe.exists(javacIn("win32", home))) candidates.push(home)
    }
  }
  return candidates
}

/** The JDK a `javac` on PATH belongs to: `<home>/bin/javac.exe`. */
function javaHomeFromJavac(probe: Probe, platform: PlatformID): string | undefined {
  const result = probe.run(platform === "win32" ? "where javac" : "command -v javac")
  if (result.code !== 0) return undefined
  const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  if (!first) return undefined
  const separator = pathSeparator(platform)
  const parts = first.split(/[\\/]/)
  const binIndex = parts.length - 2
  if (binIndex <= 0 || parts[binIndex]?.toLowerCase() !== "bin") return undefined
  return parts.slice(0, binIndex).join(separator)
}

/* --------------------------------------------------------------- resolvers */

function findGhidra(probe: Probe, env: NodeJS.ProcessEnv, platform: PlatformID): string | undefined {
  const home = absolutePath(platform === "win32" ? (env.USERPROFILE ?? env.HOME) : env.HOME, platform)

  const exported = absolutePath(env.GHIDRA_INSTALL_DIR, platform)
  if (exported && isGhidra(probe, platform, exported)) return exported

  if (platform === "win32") {
    const matching = windowsGhidraCandidates(probe, env, home).filter((candidate) => isGhidra(probe, platform, candidate))
    const accepted = matching.find((candidate) => supportedGhidra(ghidraVersion(probe, platform, candidate) ?? ""))
    if (accepted) return accepted
    if (matching.length > 0) return matching[0]
    return undefined
  }

  const prefix = brewPrefix(probe, "ghidra")
  if (prefix) {
    // Prefer Homebrew's installation only when its version is accepted by the
    // current REA. This intentionally does not pretend 12.2 is compatible.
    for (const candidate of [`${prefix}/libexec`, prefix]) {
      if (isGhidra(probe, platform, candidate) && supportedGhidra(ghidraVersion(probe, platform, candidate) ?? "")) return candidate
    }
  }

  // A manual extraction keeps Ghidra/ at the root. Prefer a release REA
  // accepts, but retain the only available release so doctor can explain why
  // the provider is unavailable instead of silently losing the path.
  const searchRoot = home ?? "/Users/unknown"
  const candidates = probe.list(`${searchRoot}/Library`).filter((name) => /^ghidra_.*_PUBLIC$/.test(name))
  const matching = candidates.map((name) => `${searchRoot}/Library/${name}`).filter((candidate) => isGhidra(probe, platform, candidate))
  const accepted = matching.find((candidate) => supportedGhidra(ghidraVersion(probe, platform, candidate) ?? ""))
  if (accepted) return accepted
  if (matching.length > 0) return matching[0]
  if (prefix) {
    for (const candidate of [`${prefix}/libexec`, prefix]) {
      if (isGhidra(probe, platform, candidate)) return candidate
    }
  }
  return undefined
}

function findJava(
  probe: Probe,
  env: NodeJS.ProcessEnv,
  platform: PlatformID,
  ghidraHome: string | undefined,
): string | undefined {
  const exported = absolutePath(env.JAVA_HOME, platform)
  if (exported && probe.exists(javacIn(platform, exported))) return exported

  const declared = declaredJava(probe, platform, ghidraHome)
  // Prefer the version Ghidra declares; the others are a fallback for a Ghidra
  // that is absent or whose bounds could not be read.
  const versions = declared ? [declared, "21", "25"] : ["21", "25"]

  for (const version of versions) {
    if (platform === "win32") {
      const home = windowsJavaCandidates(probe, env, version)[0]
      if (home) return home
      continue
    }
    const prefix = brewPrefix(probe, `openjdk@${version}`)
    if (!prefix) continue
    const home = brewJavaHome(prefix)
    if (probe.exists(javacIn(platform, home))) return home
  }

  // Last resort: a JDK that is already on PATH but was never exported.
  return javaHomeFromJavac(probe, platform)
}

/** Resolves both paths from the environment and from what the package manager installed. */
export function resolveToolchain(
  env: NodeJS.ProcessEnv,
  probe: Probe,
  platform: PlatformID = hostPlatform(),
): Toolchain {
  const ghidraHome = findGhidra(probe, env, platform)
  return { ghidraHome, javaHome: findJava(probe, env, platform, ghidraHome) }
}

/** The variables to hand REA, omitting the ones that could not be resolved. */
export function toolchainEnvironment(toolchain: Toolchain): Record<string, string> {
  const environment: Record<string, string> = {}
  if (toolchain.ghidraHome) environment.GHIDRA_INSTALL_DIR = toolchain.ghidraHome
  if (toolchain.javaHome) environment.JAVA_HOME = toolchain.javaHome
  return environment
}