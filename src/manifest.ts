/**
 * Provider identity only. The model catalog is discovered from each
 * provider's own `/v1/models` endpoint once a credential exists, so this file
 * never drifts from what the gateway actually serves.
 */

export type ProviderSpec = {
  id: string
  name: string
  baseURL: string
  /** Environment variables OpenCode may read the credential from. */
  env: string[]
  /** Human-facing label for the key prompt in the OpenCode UI. */
  credentialLabel: string
}

export const providers: ProviderSpec[] = [
  {
    id: "kodeo",
    name: "Kodeo",
    baseURL: "https://api.kodeo.com.br/v1",
    env: ["KODEO_API_KEY"],
    credentialLabel: "Kodeo API key",
  },
  {
    id: "globant",
    name: "Globant",
    baseURL: "https://api.clients.globant.com/v1",
    env: ["GLOBANT_API_KEY"],
    credentialLabel: "Globant API key",
  },
]

/**
 * Third-party artifacts this plugin verifies but never copies or vendors.
 * `install` and `update` are the upstream project's own commands, run verbatim.
 */
export type UpstreamSkill = {
  id: string
  name: string
  repository: string
  install: string
  update: string
  /** Paths, relative to the working directory, that indicate presence. */
  markers: string[]
  /** Executable whose `--version` reports the installed version. */
  versionCommand?: string
}

export const skills: UpstreamSkill[] = [
  {
    id: "superpowers",
    name: "Superpowers",
    repository: "https://github.com/obra/superpowers",
    install: "opencode plugin add github:obra/superpowers",
    update: "opencode plugin update superpowers",
    markers: [],
  },
  {
    id: "ui-ux-pro-max",
    name: "UI/UX Pro Max",
    repository: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    install: "npx -y ui-ux-pro-max-cli@latest init --ai opencode",
    update: "npx -y ui-ux-pro-max-cli@latest update --ai opencode",
    markers: [".opencode/skills/ui-ux-pro-max/SKILL.md"],
  },
  {
    id: "design-motion-principles",
    name: "Design Motion Principles",
    repository: "https://github.com/kylezantos/design-motion-principles",
    install: "npx -y skills add kylezantos/design-motion-principles",
    update: "npx -y skills add kylezantos/design-motion-principles",
    markers: [".opencode/skills/design-motion-principles/SKILL.md"],
  },
  {
    id: "rea",
    name: "REA",
    repository: "https://github.com/morluto/rea",
    install: "rea setup --client opencode --yes",
    update: "rea update && rea setup --client opencode --yes",
    markers: [],
    versionCommand: "rea",
  },
  {
    id: "graphify",
    name: "Graphify",
    repository: "https://github.com/Graphify-Labs/graphify",
    install: "uv tool install graphifyy && graphify install --platform opencode",
    update: "uv tool upgrade graphifyy && graphify install --platform opencode",
    markers: ["~/.config/opencode/skills/graphify/SKILL.md"],
    versionCommand: "graphify",
  },
]

/** Homebrew formulae and casks the machine needs before the plugin is useful. */
export const brewPackages = {
  formulae: [
    "gh",
    "node",
    "openjdk@21",
    "ffmpeg",
    "yt-dlp",
    "uv",
    "swiftformat",
    "swiftlint",
    "xcodegen",
    "tesseract",
    "unar",
  ],
  casks: ["ghidra"],
}

/** npm packages installed globally. */
export const npmPackages = ["@opencode/cli", "rea-agents"]
