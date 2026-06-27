import fs from "node:fs";

export const COMPATIBILITY_HINT = "Olympus backend routes are not mounted. Current Hermes allows bundled and user-plugin backends when manifest.api is safe; project plugins remain static-only. Check plugin source, API path validation, and dashboard restart state. Run npm run test:compat for details.";

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

export function isProjectPluginSource(source) {
  return source === "project";
}

export function isNonBundledSource(source) {
  return isProjectPluginSource(source);
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
      backendUnavailableMode: false,
      projectStaticPluginMode: false,
      projectPluginBackendBlocked: false,
      hermesBlocksProjectPluginBackendApis: false,
      // Deprecated compatibility aliases. Prefer projectStaticPluginMode and
      // hermesBlocksProjectPluginBackendApis in new callers.
      liveStaticUserPluginMode: false,
      hermesBlocksNonBundledBackendApis: false,
      likelyReason: "backend routes mounted",
      hint: "",
    };
  }

  const statuses = Object.values(routeStatus || {}).filter((value) => typeof value === "number");
  const backendRouteStatuses = [routeStatus && routeStatus.health, routeStatus && routeStatus.overview, routeStatus && routeStatus.tuning]
    .filter((value) => typeof value === "number");
  const backendRoutesAre404 = backendRouteStatuses.length > 0 && backendRouteStatuses.every((status) => status === 404);
  const projectStaticPluginMode = Boolean(
    discovered &&
    isProjectPluginSource(discovered.source) &&
    discovered.has_api === false &&
    manifestHasApi &&
    backendRoutesAre404
  );
  const sourceGuardSupportsReason = Boolean(sourceGuardDetected && backendRoutesAre404);
  const projectPluginBackendBlocked = projectStaticPluginMode || sourceGuardSupportsReason;

  return {
    backendUnavailableMode: true,
    projectStaticPluginMode,
    projectPluginBackendBlocked,
    hermesBlocksProjectPluginBackendApis: projectPluginBackendBlocked,
    // Deprecated compatibility aliases. Prefer projectStaticPluginMode and
    // hermesBlocksProjectPluginBackendApis in new callers.
    liveStaticUserPluginMode: projectStaticPluginMode,
    hermesBlocksNonBundledBackendApis: projectPluginBackendBlocked,
    likelyReason: projectPluginBackendBlocked
      ? "current Hermes refuses project dashboard plugin Python backends"
      : "backend routes unavailable; inspect Hermes dashboard plugin discovery and logs",
    hint: projectPluginBackendBlocked ? COMPATIBILITY_HINT : "",
    routeStatusesObserved: statuses.length,
  };
}
