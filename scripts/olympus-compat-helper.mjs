import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Hermes' own rule (hermes_constants._platform_default_hermes_home):
// HERMES_HOME, else %LOCALAPPDATA%\hermes on Windows and ~/.hermes elsewhere.
export function defaultHermesHome() {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
  const suffix = process.env.HERMES_DATA_DIR_SUFFIX || "";
  if (process.platform === "win32") {
    const localAppData = (process.env.LOCALAPPDATA || "").trim() || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "hermes" + suffix);
  }
  return path.join(os.homedir(), ".hermes" + suffix);
}

export function commandExists(command) {
  const probe = process.platform === "win32"
    ? spawnSync("where", [command], { encoding: "utf8" })
    : spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return probe.status === 0;
}

// Point Hermes' plugin dashboard at this checkout: a symlink, or a directory
// junction on Windows (no admin rights needed). An existing different
// dashboard is kept as a backup, and only when OLYMPUS_SMOKE_RELINK=1.
export function ensureDashboardLink(sourceDir, targetDir) {
  if (fs.existsSync(targetDir) && fs.realpathSync(targetDir) === fs.realpathSync(sourceDir)) return;
  if (fs.existsSync(targetDir)) {
    if (process.env.OLYMPUS_SMOKE_RELINK !== "1") {
      throw new Error(`Hermes already has an Olympus dashboard at ${targetDir}. Set OLYMPUS_SMOKE_RELINK=1 to replace it for this smoke run.`);
    }
    fs.renameSync(targetDir, `${targetDir}.backup.${new Date().toISOString().replace(/[:.]/g, "-")}`);
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.symlinkSync(sourceDir, targetDir, process.platform === "win32" ? "junction" : "dir");
}

export const COMPATIBILITY_HINT = "Olympus backend routes are not mounted. Current Hermes refuses non-bundled dashboard plugin Python backends for user/project plugins; bundle Olympus into Hermes or add a trusted backend-plugin model. Run npm run test:compat for details.";

export function manifestDeclaresApi(manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return Boolean(manifest && manifest.api);
  } catch {
    return false;
  }
}

export function parsePluginRows(body) {
  try {
    const rows = JSON.parse(body);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function findOlympusPlugin(rows) {
  return rows.find((row) => row && row.name === "olympus") || null;
}

export function isNonBundledSource(source) {
  return source === "user" || source === "project";
}

export function is2xx(statusCode) {
  return statusCode >= 200 && statusCode < 300;
}

export function resolvePluginSourceKind({ discovered, fallback = "unknown" }) {
  return discovered && discovered.source ? discovered.source : fallback;
}

export function backendCompatibilityStatus({
  backendMounted,
  discovered,
  manifestHasApi,
  routeStatus,
  sourceGuardDetected = false,
}) {
  if (backendMounted) {
    return {
      liveStaticUserPluginMode: false,
      hermesBlocksNonBundledBackendApis: Boolean(sourceGuardDetected),
      likelyReason: "backend routes mounted",
      hint: "",
    };
  }

  const statuses = Object.values(routeStatus || {}).filter((value) => typeof value === "number");
  const backendRouteStatuses = [routeStatus && routeStatus.health, routeStatus && routeStatus.overview, routeStatus && routeStatus.tuning]
    .filter((value) => typeof value === "number");
  const backendRoutesAre404 = backendRouteStatuses.length > 0 && backendRouteStatuses.every((status) => status === 404);
  const staticNonBundledPlugin = Boolean(
    discovered &&
    isNonBundledSource(discovered.source) &&
    discovered.has_api === false &&
    manifestHasApi &&
    backendRoutesAre404
  );
  const sourceGuardSupportsReason = Boolean(sourceGuardDetected && backendRoutesAre404);
  const blocked = staticNonBundledPlugin || sourceGuardSupportsReason;

  return {
    liveStaticUserPluginMode: staticNonBundledPlugin,
    hermesBlocksNonBundledBackendApis: blocked,
    likelyReason: blocked
      ? "current Hermes refuses non-bundled dashboard plugin Python backends"
      : "backend routes unavailable; inspect Hermes dashboard plugin discovery and logs",
    hint: blocked ? COMPATIBILITY_HINT : "",
    routeStatusesObserved: statuses.length,
  };
}
