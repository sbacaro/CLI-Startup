import { test } from "node:test"
import assert from "node:assert/strict"

import {
  commandExists,
  commandLine,
  homeFromEnv,
  hostPlatform,
  isShellWrapper,
  pathSeparator,
  shellFor,
  type PlatformID,
} from "../src/platform.ts"

const WINDOWS_ENV: NodeJS.ProcessEnv = {
  Path: String.raw`C:\Windows\system32;C:\Users\me\AppData\Local\Microsoft\WindowsApps`,
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  USERPROFILE: String.raw`C:\Users\me`,
  ProgramFiles: String.raw`C:\Program Files`,
}

test("names the host platform", () => {
  const platform = hostPlatform()
  assert.ok(["darwin", "linux", "win32"].includes(platform))
})

test("uses the separator the platform uses", () => {
  assert.equal(pathSeparator("win32"), "\\")
  assert.equal(pathSeparator("darwin"), "/")
  assert.equal(pathSeparator("linux"), "/")
})

test("finds an executable on a POSIX PATH", () => {
  const env = { PATH: "/opt/homebrew/bin:/usr/bin" }
  const seen: string[] = []
  const found = commandExists("darwin", "gh", env, (path) => {
    seen.push(path)
    return path === "/usr/bin/gh"
  })

  assert.equal(found, true)
  assert.deepEqual(seen, ["/opt/homebrew/bin/gh", "/usr/bin/gh"])
})

test("does not resolve a directory that merely starts with the name", () => {
  const env = { PATH: "/usr/bin" }
  // `gh` must not be satisfied by a sibling `ghx`: a prefix match would report
  // an installed server that cannot start.
  const found = commandExists("darwin", "gh", env, (path) => path === "/usr/bin/ghx")
  assert.equal(found, false)
})

test("appends PATHEXT on Windows, so a .cmd shim resolves", () => {
  const found = commandExists(
    "win32",
    "rea",
    WINDOWS_ENV,
    (path) => path === String.raw`C:\Users\me\AppData\Local\Microsoft\WindowsApps\rea.cmd`,
  )

  // `npm install -g` writes rea.cmd, never rea; probing the bare name would
  // report the server as missing on every start.
  assert.equal(found, true)
})

test("does not append PATHEXT twice to a name that already has an extension", () => {
  const seen: string[] = []
  commandExists("win32", "rea.cmd", WINDOWS_ENV, (path) => {
    seen.push(path)
    return false
  })

  assert.ok(seen.every((path) => !path.endsWith(".cmd.exe")), seen.join(", "))
})

test("reads PATH from any capitalization Windows may hand it", () => {
  const upper = commandExists("win32", "gh", { PATH: String.raw`C:\bin` }, (path) => path === String.raw`C:\bin\gh.exe`)
  assert.equal(upper, true)
})

test("treats a name with a separator as a path, not as a PATH entry", () => {
  const found = commandExists(
    "win32",
    String.raw`C:\tools\gh.exe`,
    WINDOWS_ENV,
    (path) => path === String.raw`C:\tools\gh.exe`,
  )
  assert.equal(found, true)
})

test("finds an absolute POSIX path without consulting PATH", () => {
  const found = commandExists("darwin", "/opt/custom/rea", { PATH: "" }, (path) => path === "/opt/custom/rea")
  assert.equal(found, true)
})

test("an empty command never resolves", () => {
  assert.equal(commandExists("linux", "  ", { PATH: "/usr/bin" }, () => true), false)
})

test("runs a POSIX command through a login shell", () => {
  const shell = shellFor("darwin", { SHELL: "/bin/zsh" }, () => true)
  assert.equal(shell.family, "posix")
  assert.equal(shell.executable, "/bin/zsh")
  assert.deepEqual(shell.args("brew install gh"), ["-lc", "brew install gh"])
})

test("fresh Linux falls back to /bin/sh", () => {
  const shell = shellFor("linux", {}, () => false)
  assert.equal(shell.executable, "/bin/sh")
})

test("runs a Windows command through PowerShell", () => {
  const shell = shellFor("win32", WINDOWS_ENV, (name) => name === "powershell.exe")
  assert.equal(shell.family, "powershell")
  assert.equal(shell.executable, "powershell.exe")
  assert.deepEqual(shell.args("winget install gh"), [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "winget install gh",
  ])
})

test("falls back to cmd.exe when PowerShell is unavailable", () => {
  const shell = shellFor("win32", WINDOWS_ENV, () => false)
  assert.equal(shell.family, "cmd")
  assert.deepEqual(shell.args("dir"), ["/d", "/s", "/c", "dir"])
})

test("splits a POSIX command line into argv", () => {
  assert.deepEqual(commandLine("darwin", "rea mcp"), ["rea", "mcp"])
})

test("routes a Windows command line through cmd.exe for a shim", () => {
  // A `.cmd` shim cannot be spawned directly by Node on Windows.
  assert.deepEqual(commandLine("win32", "rea mcp"), ["cmd.exe", "/d", "/s", "/c", "rea mcp"])
})

test("reads the home directory from the variable the platform sets", () => {
  assert.equal(homeFromEnv("win32", WINDOWS_ENV), String.raw`C:\Users\me`)
  assert.equal(homeFromEnv("darwin", { HOME: "/Users/me" }), "/Users/me")
  assert.equal(homeFromEnv("win32", { HOME: "/fallback" }), "/fallback")
})

test("a platform id narrows to the three families the code handles", () => {
  const ids: PlatformID[] = ["darwin", "linux", "win32"]
  assert.equal(ids.length, 3)
})

test("recognizes a shell used only to launch another program", () => {
  for (const name of ["cmd.exe", "cmd", "powershell.exe", "pwsh", "sh", "bash", "/bin/zsh", String.raw`C:\Windows\System32\cmd.exe`]) {
    assert.equal(isShellWrapper(name), true, name)
  }
})

test("does not mistake a real server for a shell wrapper", () => {
  for (const name of ["rea", "rea.cmd", "graphify-mcp", "github-mcp-server", "node", "python"]) {
    assert.equal(isShellWrapper(name), false, name)
  }
})