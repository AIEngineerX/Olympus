import fs from "node:fs";

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
