import type { SurfaceKind } from "../../core/docs-sync-config.js";
import { detectActionSurfaces } from "./action-yml.js";
import { detectCliArgv } from "./cli-argv.js";
import { detectCliCommands } from "./cli-commands.js";
import { detectCliFlags } from "./cli-flags.js";
import { detectEnvAdded } from "./env-added.js";
import { detectMcpTools } from "./mcp-tools.js";
import { detectPackageSurfaces } from "./package-json.js";
import type { DetectorRegistration, SurfaceDecl } from "./types.js";

/** All v1 surface detectors (structured + CLI + MCP + env). */
export const REGISTERED_DETECTOR_KINDS = [
  "action.input",
  "action.output",
  "package.bin",
  "package.exports",
  "cli.flag",
  "cli.command",
  "cli.argv",
  "mcp.tool",
  "env.added",
] as const satisfies readonly SurfaceKind[];

/** @deprecated Use REGISTERED_DETECTOR_KINDS */
export const STRUCTURED_DETECTOR_KINDS = [
  "action.input",
  "action.output",
  "package.bin",
  "package.exports",
] as const satisfies readonly SurfaceKind[];

export type StructuredDetectorKind = (typeof STRUCTURED_DETECTOR_KINDS)[number];

/**
 * Registry of implemented detectors.
 */
export function listRegisteredDetectors(): DetectorRegistration[] {
  return [
    {
      kind: "action.input",
      detect: (path, content) =>
        detectActionSurfaces(path, content).filter((s) => s.kind === "action.input"),
    },
    {
      kind: "action.output",
      detect: (path, content) =>
        detectActionSurfaces(path, content).filter((s) => s.kind === "action.output"),
    },
    {
      kind: "package.bin",
      detect: (path, content) =>
        detectPackageSurfaces(path, content, { includeExports: false }).filter(
          (s) => s.kind === "package.bin",
        ),
    },
    {
      kind: "package.exports",
      detect: (path, content) =>
        detectPackageSurfaces(path, content, { includeExports: true }).filter(
          (s) => s.kind === "package.exports",
        ),
    },
    {
      kind: "cli.flag",
      detect: (path, content) => detectCliFlags(path, content),
    },
    {
      kind: "cli.command",
      detect: (path, content) => detectCliCommands(path, content),
    },
    {
      kind: "cli.argv",
      detect: (path, content) => detectCliArgv(path, content),
    },
    {
      kind: "mcp.tool",
      detect: (path, content) => detectMcpTools(path, content),
    },
    {
      kind: "env.added",
      detect: (path, content) => detectEnvAdded(path, content),
    },
  ];
}

export function runRegisteredDetectors(options: {
  kinds: Iterable<SurfaceKind>;
  path: string;
  content: string;
  warn?: (message: string) => void;
}): SurfaceDecl[] {
  const enabled = new Set(options.kinds);
  const out: SurfaceDecl[] = [];

  if (enabled.has("action.input") || enabled.has("action.output")) {
    for (const surface of detectActionSurfaces(options.path, options.content, {
      warn: options.warn,
    })) {
      if (enabled.has(surface.kind)) {
        out.push(surface);
      }
    }
  }
  if (enabled.has("package.bin") || enabled.has("package.exports")) {
    for (const surface of detectPackageSurfaces(options.path, options.content, {
      includeExports: enabled.has("package.exports"),
      warn: options.warn,
    })) {
      if (enabled.has(surface.kind)) {
        out.push(surface);
      }
    }
  }
  if (enabled.has("cli.flag")) {
    out.push(...detectCliFlags(options.path, options.content));
  }
  if (enabled.has("cli.command")) {
    out.push(...detectCliCommands(options.path, options.content));
  }
  if (enabled.has("cli.argv")) {
    out.push(...detectCliArgv(options.path, options.content));
  }
  if (enabled.has("mcp.tool")) {
    out.push(...detectMcpTools(options.path, options.content));
  }
  if (enabled.has("env.added")) {
    out.push(...detectEnvAdded(options.path, options.content));
  }
  return out;
}

export function isRegisteredDetectorKind(kind: SurfaceKind): boolean {
  return (REGISTERED_DETECTOR_KINDS as readonly string[]).includes(kind);
}

export function isStructuredDetectorKind(kind: SurfaceKind): boolean {
  return (STRUCTURED_DETECTOR_KINDS as readonly string[]).includes(kind);
}
