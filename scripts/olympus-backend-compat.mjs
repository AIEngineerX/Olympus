#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backendCompatibilityStatus,
  findOlympusPlugin,
  manifestDeclaresApi,
  parsePluginRows,
  resolvePluginSourceKind,
} from "./olympus-compat-helper.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.OLYMPUS_SMOKE_URL || "http://127.0.0.1:9119/olympus";
const hermesHome = process.env.HERMES_HOME || path.join(process.env.HOME || "", ".hermes");
const dashboardSourceDir = path.join(repoRoot, "dashboard");
const dashboardTargetDir = path.join(hermesHome, "plugins", "olympus", "dashboard");
const manifestPath = path.join(dashboardSourceDir, "manifest.json");

function requestText(url, options = {}, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(parsed, {
      method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, body }));
    });
    req.on("error", (error) => resolve({ statusCode: 0, body: String(error && error.message ? error.message : error) }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ statusCode: 0, body: "request timed out" });
    });
    req.end();
  });
}

function readlinkTarget(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isSymbolicLink()) return { exists: true, isSymlink: false, target: filePath };
    const raw = fs.readlinkSync(filePath);
    return { exists: true, isSymlink: true, target: path.resolve(path.dirname(filePath), raw) };
  } catch {
    return { exists: false, isSymlink: false, target: "" };
  }
}

async function sessionToken() {
  const page = await requestText(baseUrl);
  const match = page.body.match(/window\.__HERMES_SESSION_TOKEN__="([^"]+)"/);
  return { token: match ? match[1] : "", pageStatus: page.statusCode };
}

async function main() {
  const link = readlinkTarget(dashboardTargetDir);
  const { token, pageStatus } = await sessionToken();
  const headers = token ? { "X-Hermes-Session-Token": token } : {};
  const [plugins, health, overview] = await Promise.all([
    requestText(new URL("/api/dashboard/plugins", baseUrl).toString(), { headers }),
    requestText(new URL("/api/plugins/olympus/health", baseUrl).toString(), { headers }),
    requestText(new URL("/api/plugins/olympus/overview", baseUrl).toString(), { headers }),
  ]);
  const discovered = findOlympusPlugin(parsePluginRows(plugins.body));
  const routeStatus = {
    dashboardPlugins: plugins.statusCode,
    health: health.statusCode,
    overview: overview.statusCode,
  };
  const backendMounted = health.statusCode >= 200 && health.statusCode < 300 && overview.statusCode >= 200 && overview.statusCode < 300;
  const manifestHasApi = manifestDeclaresApi(manifestPath);
  const compatibility = backendCompatibilityStatus({
    backendMounted,
    discovered,
    manifestHasApi,
    routeStatus,
  });
  const result = {
    ok: pageStatus >= 200 && pageStatus < 400 && Boolean(discovered) && Boolean(compatibility.likelyReason),
    backendMounted,
    likelyReason: compatibility.likelyReason,
    baseUrl,
    pageStatus,
    sessionTokenDetected: Boolean(token),
    dashboardTarget: dashboardTargetDir,
    dashboardTargetExists: link.exists,
    dashboardTargetIsSymlink: link.isSymlink,
    dashboardTargetResolvesToRepo: path.resolve(link.target || "") === dashboardSourceDir,
    sourceKind: resolvePluginSourceKind({ discovered }),
    backendUnavailableMode: compatibility.backendUnavailableMode,
    projectStaticPluginMode: compatibility.projectStaticPluginMode,
    projectPluginBackendBlocked: compatibility.projectPluginBackendBlocked,
    hermesBlocksProjectPluginBackendApis: compatibility.hermesBlocksProjectPluginBackendApis,
    deprecatedCompatibilityFields: ["liveStaticUserPluginMode", "hermesBlocksNonBundledBackendApis"],
    liveStaticUserPluginMode: compatibility.liveStaticUserPluginMode,
    hermesBlocksNonBundledBackendApis: compatibility.hermesBlocksNonBundledBackendApis,
    manifestHasApi,
    pluginManifestDiscovered: Boolean(discovered),
    pluginHasApi: discovered ? Boolean(discovered.has_api) : null,
    pluginSource: discovered ? discovered.source : null,
    routeStatus,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
