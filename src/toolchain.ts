/**
 * Finds the Ghidra installation and the JDK that REA needs.
 *
 * REA does not install either one, and it rejects a relative or empty
 * `JAVA_HOME` outright. A machine can therefore look provisioned while every
 * REA start fails: the variable exists, but it is blank or points at a folder
 * that was deleted. Resolving both here, from what is actually on disk, keeps
 * that failure out of the MCP registration.
 */

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

const GHIDRA_PROPERTIES = "Ghidra/application.properties"

/** REA 6.8.0 currently verifies the 12.1 line (including 12.1.4). */
export function supportedGhidra(version: string): boolean {
  return /^12\.1(?:\.\d+)?$/.test(version)
}

/** A value usable as a path: present and absolute. REA rejects everything else. */
function absolutePath(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!value.startsWith("/")) return undefined
  return value.replace(/\/+$/, "")
}

/** A Homebrew prefix, or undefined when the formula is not installed. */
function brewPrefix(probe: Probe, formula: string): string | undefined {
  const result = probe.run(`brew --prefix ${formula}`)
  if (result.code !== 0) return undefined
  return absolutePath(result.stdout.trim())
}

/** Whether `path` holds an extracted Ghidra release. */
function isGhidra(probe: Probe, path: string): boolean {
  return probe.exists(`${path}/${GHIDRA_PROPERTIES}`)
}

function ghidraVersion(probe: Probe, path: string): string | undefined {
  const text = probe.read(`${path}/${GHIDRA_PROPERTIES}`)
  return /^application\.version\s*=\s*(\S+)/m.exec(text ?? "")?.[1]
}

/**
 * The Java release Ghidra declares, read from its own properties file.
 *
 * Current Ghidra 12.1 builds want 21 and 12.2 wants 25, so the version is read
 * rather than hardcoded: a hardcoded JDK is how a working install breaks on the
 * next Ghidra release.
 */
function declaredJava(probe: Probe, ghidraHome: string | undefined): string | undefined {
  if (!ghidraHome) return undefined
  const text = probe.read(`${ghidraHome}/${GHIDRA_PROPERTIES}`)
  if (!text) return undefined
  const match = /^application\.java\.min\s*=\s*(\d+)/m.exec(text)
  return match?.[1]
}

/** The JDK home inside a keg-only Homebrew formula. */
function brewJavaHome(prefix: string): string {
  return `${prefix}/libexec/openjdk.jdk/Contents/Home`
}

function findGhidra(probe: Probe, env: NodeJS.ProcessEnv): string | undefined {
  const exported = absolutePath(env.GHIDRA_INSTALL_DIR)
  if (exported && isGhidra(probe, exported)) return exported

  const prefix = brewPrefix(probe, "ghidra")
  if (prefix) {
    // Prefer Homebrew's installation only when its version is accepted by the
    // current REA. This intentionally does not pretend 12.2 is compatible.
    for (const candidate of [`${prefix}/libexec`, prefix]) {
      if (isGhidra(probe, candidate) && supportedGhidra(ghidraVersion(probe, candidate) ?? "")) return candidate
    }
  }

  // A manual extraction keeps Ghidra/ at the root. Prefer a release REA
  // accepts, but retain the only available release so doctor can explain why
  // the provider is unavailable instead of silently losing the path.
  const home = absolutePath(env.HOME) ?? "/Users/unknown"
  const candidates = probe.list(`${home}/Library`).filter((name) => /^ghidra_.*_PUBLIC$/.test(name))
  const matching = candidates
    .map((name) => `${home}/Library/${name}`)
    .filter((candidate) => isGhidra(probe, candidate))
  const accepted = matching.find((candidate) => supportedGhidra(ghidraVersion(probe, candidate) ?? ""))
  if (accepted) return accepted
  if (matching.length > 0) return matching[0]
  if (prefix) {
    for (const candidate of [`${prefix}/libexec`, prefix]) {
      if (isGhidra(probe, candidate)) return candidate
    }
  }
  return undefined
}

function findJava(
  probe: Probe,
  env: NodeJS.ProcessEnv,
  ghidraHome: string | undefined,
): string | undefined {
  const exported = absolutePath(env.JAVA_HOME)
  if (exported && probe.exists(`${exported}/bin/javac`)) return exported

  const declared = declaredJava(probe, ghidraHome)
  // Prefer the version Ghidra declares; the others are a fallback for a Ghidra
  // that is absent or whose bounds could not be read.
  const versions = declared ? [declared, "21", "25"] : ["21", "25"]

  for (const version of versions) {
    const prefix = brewPrefix(probe, `openjdk@${version}`)
    if (!prefix) continue
    const home = brewJavaHome(prefix)
    if (probe.exists(`${home}/bin/javac`)) return home
  }
  return undefined
}

/** Resolves both paths from the environment and from what Homebrew installed. */
export function resolveToolchain(env: NodeJS.ProcessEnv, probe: Probe): Toolchain {
  const ghidraHome = findGhidra(probe, env)
  return { ghidraHome, javaHome: findJava(probe, env, ghidraHome) }
}

/** The variables to hand REA, omitting the ones that could not be resolved. */
export function toolchainEnvironment(toolchain: Toolchain): Record<string, string> {
  const environment: Record<string, string> = {}
  if (toolchain.ghidraHome) environment.GHIDRA_INSTALL_DIR = toolchain.ghidraHome
  if (toolchain.javaHome) environment.JAVA_HOME = toolchain.javaHome
  return environment
}
