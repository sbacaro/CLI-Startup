import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveToolchain, supportedGhidra, type Probe } from "../src/toolchain.ts"

const GHIDRA_PROPERTIES = "Ghidra/application.properties"

/** A machine with nothing installed, which each test then describes. */
function probe(overrides: Partial<Probe> = {}): Probe {
  return {
    run: () => ({ code: 1, stdout: "" }),
    exists: () => false,
    read: () => undefined,
    list: () => [],
    ...overrides,
  }
}

/** An extracted release under `~/Library`, the shape the official zip has. */
function extracted(root: string, version: string): { dir: string; files: Record<string, string> } {
  const dir = `${root}/ghidra_${version}_PUBLIC`
  return { dir, files: { [`${dir}/${GHIDRA_PROPERTIES}`]: `application.version=${version}\napplication.java.min=21\n` } }
}

function homebrew(options: {
  ghidraPrefix?: string
  /** Homebrew prefixes (`/opt/homebrew/opt/openjdk@21`) keyed by JDK version. */
  javaPrefixes?: Record<string, string>
  javaMin?: string
}): Probe {
  const javaHome = (version: string) => {
    const prefix = options.javaPrefixes?.[version]
    return prefix ? `${prefix}/libexec/openjdk.jdk/Contents/Home` : undefined
  }

  return probe({
    run: (command) => {
      if (command.startsWith("brew --prefix ghidra")) {
        return options.ghidraPrefix
          ? { code: 0, stdout: `${options.ghidraPrefix}\n` }
          : { code: 1, stdout: "" }
      }
      const match = /brew --prefix openjdk@(\S+)/.exec(command)
      if (match) {
        const prefix = options.javaPrefixes?.[match[1]!]
        return prefix ? { code: 0, stdout: `${prefix}\n` } : { code: 1, stdout: "" }
      }
      return { code: 1, stdout: "" }
    },
    exists: (path) => {
      if (options.ghidraPrefix && path === `${options.ghidraPrefix}/libexec/${GHIDRA_PROPERTIES}`) return true
      for (const version of Object.keys(options.javaPrefixes ?? {})) {
        if (path === `${javaHome(version)}/bin/javac`) return true
      }
      return false
    },
    read: (path) =>
      options.ghidraPrefix && path === `${options.ghidraPrefix}/libexec/${GHIDRA_PROPERTIES}`
        ? `application.version=12.2\napplication.java.min=${options.javaMin ?? "25"}\n`
        : undefined,
  })
}

test("an exported GHIDRA_INSTALL_DIR wins when it holds a Ghidra release", () => {
  const dir = "/opt/ghidra_12.1.4_PUBLIC"
  const toolchain = resolveToolchain(
    { GHIDRA_INSTALL_DIR: dir, HOME: "/Users/me" },
    probe({
      exists: (path) => path === `${dir}/${GHIDRA_PROPERTIES}`,
      read: (path) => (path === `${dir}/${GHIDRA_PROPERTIES}` ? "application.java.min=21\n" : undefined),
    }),
  )

  assert.equal(toolchain.ghidraHome, dir)
})

test("a stale GHIDRA_INSTALL_DIR falls back to the Homebrew formula", () => {
  const prefix = "/opt/homebrew/opt/ghidra"
  const toolchain = resolveToolchain(
    { GHIDRA_INSTALL_DIR: "/Users/someone/Library/ghidra_12.1.4_PUBLIC", HOME: "/Users/someone" },
    homebrew({ ghidraPrefix: prefix, javaMin: "25", javaPrefixes: { "25": "/opt/homebrew/opt/openjdk@25" } }),
  )

  // The exported path does not exist on disk, so trusting it would make REA
  // report an installation failure on every start.
  assert.equal(toolchain.ghidraHome, `${prefix}/libexec`)
})

test("an empty JAVA_HOME counts as unset", () => {
  const prefix = "/opt/homebrew/opt/ghidra"
  const toolchain = resolveToolchain(
    { JAVA_HOME: "", HOME: "/Users/me" },
    homebrew({ ghidraPrefix: prefix, javaMin: "25", javaPrefixes: { "25": "/opt/homebrew/opt/openjdk@25" } }),
  )

  // REA rejects an empty JAVA_HOME outright, so passing it through as if it
  // were a real setting is what broke the first run.
  assert.equal(toolchain.javaHome, "/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home")
})

test("picks the JDK version Ghidra declares, not a hardcoded one", () => {
  const prefix = "/opt/homebrew/opt/ghidra"
  const asked: string[] = []
  const machine = homebrew({
    ghidraPrefix: prefix,
    javaMin: "21",
    javaPrefixes: {
      "21": "/opt/homebrew/opt/openjdk@21",
      // Installed, but Ghidra declares 21, so this one must not be chosen.
      "25": "/opt/homebrew/opt/openjdk@25",
    },
  })
  const run = machine.run
  machine.run = (command) => {
    const match = /brew --prefix openjdk@(\S+)/.exec(command)
    if (match) asked.push(match[1]!)
    return run(command)
  }

  const toolchain = resolveToolchain({ HOME: "/Users/me" }, machine)

  assert.equal(toolchain.javaHome, "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home")
  assert.deepEqual(asked, ["21"])
})

test("keeps a valid exported JAVA_HOME without probing Homebrew", () => {
  const java = "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home"
  const toolchain = resolveToolchain(
    { JAVA_HOME: java, HOME: "/Users/me" },
    probe({ exists: (path) => path === `${java}/bin/javac` }),
  )

  assert.equal(toolchain.javaHome, java)
})

test("reports nothing when neither the environment nor Homebrew provides Ghidra", () => {
  const toolchain = resolveToolchain({ GHIDRA_INSTALL_DIR: "", HOME: "/Users/me" }, probe())

  assert.equal(toolchain.ghidraHome, undefined)
  assert.equal(toolchain.javaHome, undefined)
})

test("prefers a Ghidra line REA accepts over a newer unsupported one", () => {
  const supported = extracted("/Users/me/Library", "12.1.4")
  const unsupported = extracted("/Users/me/Library", "12.2")
  const files = { ...supported.files, ...unsupported.files }

  const toolchain = resolveToolchain(
    { HOME: "/Users/me" },
    probe({
      run: (command) =>
        command.startsWith("brew --prefix ghidra")
          ? { code: 0, stdout: "/opt/homebrew/opt/ghidra\n" }
          : { code: 1, stdout: "" },
      exists: (path) => path === "/opt/homebrew/opt/ghidra/libexec/Ghidra/application.properties" || path in files,
      read: (path) =>
        path === "/opt/homebrew/opt/ghidra/libexec/Ghidra/application.properties"
          ? "application.version=12.2\napplication.java.min=25\n"
          : files[path],
      list: (path) => (path === "/Users/me/Library" ? ["ghidra_12.1.4_PUBLIC", "ghidra_12.2_PUBLIC"] : []),
    }),
  )

  // Homebrew ships 12.2, which REA 6.8 rejects. Choosing it would leave the
  // server unable to start even though every other check passes.
  assert.equal(toolchain.ghidraHome, supported.dir)
})

test("falls back to an unsupported release when it is the only one present", () => {
  const only = extracted("/Users/me/Library", "12.2")
  const toolchain = resolveToolchain(
    { HOME: "/Users/me" },
    probe({
      exists: (path) => path in only.files,
      read: (path) => only.files[path],
      list: () => ["ghidra_12.2_PUBLIC"],
    }),
  )

  assert.equal(toolchain.ghidraHome, only.dir)
})

test("names the Ghidra lines REA accepts", () => {
  assert.ok(supportedGhidra("12.1.4"))
  assert.ok(!supportedGhidra("12.2"))
  assert.ok(!supportedGhidra("11.4"))
})

/* --------------------------------------------------------------- Windows */

const WINDOWS_ENV: NodeJS.ProcessEnv = {
  USERPROFILE: String.raw`C:\Users\me`,
  ProgramFiles: String.raw`C:\Program Files`,
  LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local`,
  Path: String.raw`C:\Windows\system32`,
}

/** A Windows machine described by the directories and files it holds. */
function windowsMachine(files: Record<string, string>, directories: Record<string, string[]> = {}): Probe {
  return probe({
    run: () => ({ code: 1, stdout: "" }),
    exists: (path) => path in files,
    read: (path) => files[path],
    list: (path) => directories[path] ?? [],
  })
}

test("finds a Ghidra release unpacked into the home folder on Windows", () => {
  const home = String.raw`C:\Users\me\ghidra_12.1.4_PUBLIC`
  const machine = windowsMachine(
    { [String.raw`${home}\Ghidra\application.properties`]: "application.version=12.1.4\napplication.java.min=21\n" },
    { [String.raw`C:\Users\me`]: ["Downloads", "ghidra_12.1.4_PUBLIC"] },
  )

  const toolchain = resolveToolchain(WINDOWS_ENV, machine, "win32")

  // Explorer's "Extract All" defaults to a sibling folder of the zip, so a
  // hand-unpacked release is normally here and never on PATH.
  assert.equal(toolchain.ghidraHome, home)
})

test("finds a Ghidra release unpacked under Program Files on Windows", () => {
  const home = String.raw`C:\Program Files\ghidra_12.1.4_PUBLIC`
  const machine = windowsMachine(
    { [String.raw`${home}\Ghidra\application.properties`]: "application.version=12.1.4\n" },
    { [String.raw`C:\Program Files`]: ["ghidra_12.1.4_PUBLIC"] },
  )

  assert.equal(resolveToolchain(WINDOWS_ENV, machine, "win32").ghidraHome, home)
})

test("keeps a Windows drive-letter GHIDRA_INSTALL_DIR", () => {
  const dir = String.raw`D:\tools\ghidra_12.1.4_PUBLIC`
  const machine = windowsMachine({ [String.raw`${dir}\Ghidra\application.properties`]: "application.version=12.1.4\n" })

  // A POSIX-only absolute check rejects every Windows path, which would leave
  // REA pointing at nothing on the one platform where it is not on PATH.
  assert.equal(resolveToolchain({ ...WINDOWS_ENV, GHIDRA_INSTALL_DIR: dir }, machine, "win32").ghidraHome, dir)
})

test("ignores a relative GHIDRA_INSTALL_DIR on Windows", () => {
  const machine = windowsMachine({ [String.raw`ghidra\Ghidra\application.properties`]: "application.version=12.1.4\n" })
  assert.equal(resolveToolchain({ ...WINDOWS_ENV, GHIDRA_INSTALL_DIR: "ghidra" }, machine, "win32").ghidraHome, undefined)
})

test("finds the JDK Ghidra declares under Program Files", () => {
  const java = String.raw`C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot`
  const machine = windowsMachine(
    { [String.raw`${java}\bin\javac.exe`]: "" },
    { [String.raw`C:\Program Files\Eclipse Adoptium`]: ["jdk-21.0.5.11-hotspot"] },
  )

  const toolchain = resolveToolchain(WINDOWS_ENV, machine, "win32")
  assert.equal(toolchain.javaHome, java)
})

test("prefers the JDK version Ghidra declares on Windows too", () => {
  const twentyOne = String.raw`C:\Program Files\Eclipse Adoptium\jdk-21`
  const twentyFive = String.raw`C:\Program Files\Eclipse Adoptium\jdk-25`
  const files = { [String.raw`${twentyOne}\bin\javac.exe`]: "", [String.raw`${twentyFive}\bin\javac.exe`]: "" }
  const ghidra = String.raw`C:\Ghidra\ghidra_12.1.4_PUBLIC`

  const machine = windowsMachine(
    {
      ...files,
      [String.raw`${ghidra}\Ghidra\application.properties`]: "application.version=12.1.4\napplication.java.min=21\n",
    },
    {
      [String.raw`C:\Program Files\Eclipse Adoptium`]: ["jdk-21", "jdk-25"],
      [String.raw`C:\Users\me`]: ["ghidra_12.1.4_PUBLIC"],
    },
  )

  // Ghidra declares 21, so 25 must not be chosen just because it is newer.
  assert.equal(resolveToolchain({ ...WINDOWS_ENV, GHIDRA_INSTALL_DIR: ghidra }, machine, "win32").javaHome, twentyOne)
})

test("does not mistake jdk-25 for jdk-2", () => {
  const wrong = String.raw`C:\Program Files\Eclipse Adoptium\jdk-210`
  const right = String.raw`C:\Program Files\Eclipse Adoptium\jdk-21`
  const machine = windowsMachine(
    { [String.raw`${wrong}\bin\javac.exe`]: "", [String.raw`${right}\bin\javac.exe`]: "" },
    // `jdk-210` contains "21" but is not the 21 line.
    { [String.raw`C:\Program Files\Eclipse Adoptium`]: ["jdk-210", "jdk-21"] },
  )

  assert.equal(resolveToolchain(WINDOWS_ENV, machine, "win32").javaHome, right)
})

test("falls back to the javac already on PATH on Windows", () => {
  const java = String.raw`C:\Program Files\Java\jdk-21`
  const machine = probe({
    run: (command) =>
      command.startsWith("where javac") ? { code: 0, stdout: `${java}\\bin\\javac.exe\r\n` } : { code: 1, stdout: "" },
    exists: () => false,
  })

  // A machine where the JDK is on PATH but JAVA_HOME was never exported is the
  // common case after a winget install.
  assert.equal(resolveToolchain(WINDOWS_ENV, machine, "win32").javaHome, java)
})

test("keeps a Windows JAVA_HOME that holds javac.exe", () => {
  const java = String.raw`C:\jdk\21`
  const machine = windowsMachine({ [String.raw`${java}\bin\javac.exe`]: "" })

  assert.equal(resolveToolchain({ ...WINDOWS_ENV, JAVA_HOME: java }, machine, "win32").javaHome, java)
})

test("an empty JAVA_HOME counts as unset on Windows", () => {
  const java = String.raw`C:\Program Files\Eclipse Adoptium\jdk-21`
  const machine = windowsMachine(
    { [String.raw`${java}\bin\javac.exe`]: "" },
    { [String.raw`C:\Program Files\Eclipse Adoptium`]: ["jdk-21"] },
  )

  assert.equal(resolveToolchain({ ...WINDOWS_ENV, JAVA_HOME: "" }, machine, "win32").javaHome, java)
})

test("reports nothing when a Windows machine has neither tool", () => {
  const toolchain = resolveToolchain(WINDOWS_ENV, probe(), "win32")
  assert.equal(toolchain.ghidraHome, undefined)
  assert.equal(toolchain.javaHome, undefined)
})

test("a POSIX machine never scans Windows install directories", () => {
  const asked: string[] = []
  const machine = probe({
    run: (command) => {
      asked.push(command)
      return { code: 1, stdout: "" }
    },
    exists: () => false,
    list: (path) => {
      asked.push(`list:${path}`)
      return []
    },
  })

  resolveToolchain({ HOME: "/Users/me", ProgramFiles: String.raw`C:\Program Files` }, machine, "darwin")

  assert.ok(asked.every((entry) => !entry.includes("C:" )), asked.join(", "))
})
