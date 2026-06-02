(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  const { React } = SDK;
  const { useEffect, useMemo, useRef, useState } = SDK.hooks;
  const C = SDK.components || {};
  const Badge = C.Badge || "span";
  const Button = C.Button || "button";

  const API = "/api/plugins/olympus";

  function el(type, props, ...children) {
    return React.createElement(type, props || null, ...children);
  }

  function cx(...parts) {
    return parts.filter(Boolean).join(" ");
  }

  function asList(value) {
    return Array.isArray(value) ? value : [];
  }

  function stateClass(state) {
    return "olympus-state olympus-state-" + String(state || "unknown").toLowerCase();
  }

  function StatePill({ state, label }) {
    return el("span", { className: stateClass(state) }, label || state || "unknown");
  }

  function severityClass(severity) {
    return "olympus-severity olympus-severity-" + String(severity || "info").toLowerCase();
  }

  function routeLink(path) {
    if (!path) return "#";
    return path.startsWith("/") ? path : "/" + path;
  }

  function Hero({ health, score, loading, onRefresh }) {
    const status = health.status || (loading ? "checking" : "unknown");
    const statusLabel = health.status_label || status;
    return el("section", { className: "olympus-hero" },
      el("div", { className: "olympus-hero-copy" },
        el("div", { className: "olympus-kicker" }, "HermesOS Agent HQ"),
        el("h1", null, "Olympus"),
        el("p", null, "A read-only HermesOS cockpit for deciding what to tune next across routes, profiles, skills, schedules, tools, memory, Kanban, MCP, and gateways."),
        el("div", { className: "olympus-hero-actions" },
          el(StatePill, { state: status, label: statusLabel }),
          el(Button, { className: "olympus-refresh", onClick: onRefresh, disabled: loading }, loading ? "Refreshing" : "Refresh")
        ),
        health.summary ? el("p", { className: "olympus-health-summary" }, health.summary) : null
      ),
      el("div", { className: "olympus-oracle" },
        el("span", null, "Tuning score"),
        el("strong", null, String(score)),
        el("small", null, "read-only scan")
      )
    );
  }

  function ScoreExplainer({ tuning }) {
    const breakdown = (tuning && tuning.score_breakdown) || {};
    const methodology = (tuning && tuning.methodology) || {};
    const deductions = asList(breakdown.deductions);
    const thresholds = asList(methodology.thresholds);
    const sources = asList(methodology.sources);
    return el("section", { className: "olympus-section olympus-score-card" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "What the Score Means"),
          el("p", null, breakdown.explanation || "A transparent heuristic readiness score from local Hermes evidence.")
        ),
        el(StatePill, { state: (breakdown.score || 0) >= 85 ? "ok" : (breakdown.score || 0) >= 55 ? "warning" : "error", label: breakdown.label || "Score" })
      ),
      el("div", { className: "olympus-score-grid" },
        el("div", { className: "olympus-score-pane" },
          el("h3", null, "Breakdown"),
          el("div", { className: "olympus-score-total" },
            el("span", null, "Starts at"),
            el("strong", null, String(breakdown.base || 100)),
            el("span", null, "Current"),
            el("strong", null, String(breakdown.score || 0))
          ),
          deductions.length ? deductions.map((item, idx) => el("div", { key: idx, className: "olympus-score-deduction" },
            el("div", null,
              el("strong", null, item.label || "Deduction"),
              el("small", null, item.reason || "")
            ),
            el("span", null, "-" + String(item.points || 0)),
            el("em", null, [item.evidence, item.source].filter(Boolean).join(" / "))
          )) : el("p", { className: "olympus-muted" }, "No deductions in this scan.")
        ),
        el("div", { className: "olympus-score-pane" },
          el("h3", null, "Method"),
          el("details", { className: "olympus-details olympus-method-list" },
            el("summary", null, "Why these signals are used"),
            thresholds.map((item, idx) => el("div", { key: idx, className: "olympus-method-row" },
              el("strong", null, item.signal || "Signal"),
              el("span", null, item.threshold || ""),
              el("small", null, item.why || "")
            ))
          ),
          sources.length ? el("details", { className: "olympus-details olympus-source-list" },
            el("summary", null, "Source basis"),
            sources.map((item, idx) => el("div", { key: idx, className: "olympus-source-row" },
              el("strong", null, item.label || "Source"),
              el("small", null, item.detail || "")
            ))
          ) : null
        )
      )
    );
  }

  const WORLD_W = 1120;
  const WORLD_H = 560;

  const PALETTE = {
    void: "#08070b",
    night: "#111528",
    dusk: "#24345c",
    sky: "#4f78a8",
    cloudLight: "#fff5dc",
    cloudMid: "#d6d2bb",
    cloudDark: "#9da0a4",
    mountainFar: "#5f6874",
    mountainNear: "#38404a",
    marbleLight: "#fff4d3",
    marbleMid: "#d7c39a",
    marbleDark: "#8d7754",
    marbleCut: "#5b514c",
    bronze: "#9a5e2b",
    bronzeDark: "#4b2d1e",
    gold: "#f3bf3d",
    goldLight: "#ffe28d",
    aether: "#52d8d2",
    aetherDark: "#1b7476",
    laurel: "#65b36d",
    warning: "#e9a94a",
    danger: "#db6657",
    ok: "#57c982",
    ink: "#211b25",
    skin: "#e1b08d",
    white: "#fffaf0",
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function fill(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function poly(ctx, points, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point[0], point[1]);
      else ctx.lineTo(point[0], point[1]);
    });
    ctx.closePath();
    ctx.fill();
  }

  function line(ctx, x1, y1, x2, y2, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    ctx.beginPath();
    ctx.moveTo(Math.round(x1), Math.round(y1));
    ctx.lineTo(Math.round(x2), Math.round(y2));
    ctx.stroke();
  }

  function dither(ctx, x, y, w, h, color, gap, offset) {
    ctx.fillStyle = color;
    for (let yy = y + ((offset || 0) % gap); yy < y + h; yy += gap) {
      for (let xx = x + (((yy / gap) | 0) % 2) * gap; xx < x + w; xx += gap * 2) {
        ctx.fillRect(Math.round(xx), Math.round(yy), 2, 2);
      }
    }
  }

  function stateMaterial(state) {
    const key = String(state || "unknown").toLowerCase();
    if (["ok", "active", "running", "recent", "scheduled"].includes(key)) return PALETTE.ok;
    if (["error", "critical", "stale", "failed"].includes(key)) return PALETTE.danger;
    if (["warning", "checking", "idle", "paused"].includes(key)) return PALETTE.warning;
    return PALETTE.aether;
  }

  function roleKey(person) {
    return String((person && (person.name || person.role)) || "").toLowerCase();
  }

  function roleShort(person) {
    const key = roleKey(person);
    if (key.includes("hermes")) return "route";
    if (key.includes("athena")) return "review";
    if (key.includes("hephaestus")) return "tools";
    if (key.includes("apollo")) return "cron";
    if (key.includes("mnemosyne")) return "memory";
    if (key.includes("argus")) return "watch";
    if (key.includes("iris")) return "relay";
    if (key.includes("chronos")) return "fresh";
    return "agent";
  }

  function drawTinyLabel(ctx, text, x, y, color) {
    const label = String(text || "").slice(0, 10);
    ctx.save();
    ctx.font = "bold 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "top";
    const width = Math.ceil(ctx.measureText(label).width) + 12;
    fill(ctx, x - width / 2, y, width, 18, "rgba(8,7,11,0.72)");
    fill(ctx, x - width / 2, y, width, 3, color);
    ctx.fillStyle = PALETTE.white;
    ctx.fillText(label, Math.round(x - width / 2 + 6), Math.round(y + 4));
    ctx.restore();
  }

  function drawBackground(ctx, t) {
    const sky = ctx.createLinearGradient(0, 0, 0, 330);
    sky.addColorStop(0, PALETTE.night);
    sky.addColorStop(0.54, PALETTE.dusk);
    sky.addColorStop(1, PALETTE.sky);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    for (let i = 0; i < 46; i += 1) {
      const x = (i * 89 + 37) % WORLD_W;
      const y = 22 + ((i * 53) % 180);
      const pulse = (Math.sin(t * 1.8 + i) + 1) * 0.5;
      fill(ctx, x, y, i % 4 === 0 ? 4 : 2, i % 4 === 0 ? 4 : 2, pulse > 0.55 ? PALETTE.white : PALETTE.cloudLight);
    }

    fill(ctx, 924, 34, 44, 44, PALETTE.goldLight);
    fill(ctx, 936, 22, 20, 68, "rgba(255, 226, 141, 0.35)");
    fill(ctx, 912, 46, 68, 20, "rgba(255, 226, 141, 0.22)");
    line(ctx, 844, 68, 1044, 68, "rgba(255, 226, 141, 0.28)", 2);
    line(ctx, 944, 0, 944, 124, "rgba(255, 226, 141, 0.20)", 2);

    drawCloud(ctx, 88 + (t * 7) % 60, 94, 1.1);
    drawCloud(ctx, 724 - (t * 4) % 60, 122, 0.9);
    drawCloud(ctx, 470 + Math.sin(t * 0.4) * 20, 180, 1.45);

    poly(ctx, [[0, 354], [100, 194], [190, 330], [310, 132], [448, 334], [596, 174], [744, 340], [900, 116], [1120, 354], [1120, 560], [0, 560]], PALETTE.mountainFar);
    dither(ctx, 0, 164, WORLD_W, 210, "rgba(255, 244, 211, 0.15)", 18, 3);
    poly(ctx, [[0, 386], [126, 268], [264, 388], [410, 212], [564, 390], [708, 250], [846, 394], [1002, 244], [1120, 382], [1120, 560], [0, 560]], PALETTE.mountainNear);
    dither(ctx, 0, 238, WORLD_W, 168, "rgba(8, 7, 11, 0.20)", 16, 1);
  }

  function drawCloud(ctx, x, y, scale) {
    const unit = 14 * scale;
    fill(ctx, x, y + unit, unit * 7, unit * 1.4, PALETTE.cloudMid);
    fill(ctx, x + unit, y, unit * 2.3, unit * 2.2, PALETTE.cloudLight);
    fill(ctx, x + unit * 3, y - unit * 0.3, unit * 2.8, unit * 2.5, PALETTE.cloudLight);
    fill(ctx, x + unit * 5.2, y + unit * 0.4, unit * 2.2, unit * 2, PALETTE.cloudLight);
    fill(ctx, x + unit * 0.5, y + unit * 2.2, unit * 6.8, unit * 0.45, PALETTE.cloudDark);
  }

  function drawTerraces(ctx, t) {
    poly(ctx, [[100, 420], [560, 278], [1016, 420], [560, 538]], "#292c32");
    poly(ctx, [[130, 408], [560, 292], [986, 408], [560, 506]], PALETTE.marbleMid);
    poly(ctx, [[160, 404], [560, 318], [956, 404], [560, 480]], PALETTE.marbleLight);
    dither(ctx, 150, 332, 820, 130, "rgba(141,119,84,0.34)", 15, 7);

    poly(ctx, [[338, 424], [560, 356], [782, 424], [560, 492]], "#bca87f");
    poly(ctx, [[370, 420], [560, 372], [750, 420], [560, 468]], "#f2dfaf");
    for (let i = 0; i < 8; i += 1) {
      const y = 418 + i * 12;
      line(ctx, 392 + i * 11, y, 728 - i * 11, y, "rgba(91,81,76,0.36)", 2);
    }

    const routeColor = (Math.sin(t * 2.8) > 0 ? PALETTE.aether : PALETTE.goldLight);
    for (let i = 0; i < 8; i += 1) {
      const p = (i + (t * 1.4) % 1) / 8;
      const x = 560 + Math.sin(p * Math.PI * 2) * 316;
      const y = 418 - Math.cos(p * Math.PI * 2) * 74;
      fill(ctx, x, y, 8, 4, routeColor);
    }
  }

  function drawTemple(ctx, score, t) {
    const cx = 560;
    const beacon = clamp(score || 0, 0, 100);
    fill(ctx, 344, 326, 432, 22, PALETTE.marbleDark);
    fill(ctx, 368, 306, 384, 28, PALETTE.marbleMid);
    fill(ctx, 394, 284, 332, 32, PALETTE.marbleLight);
    dither(ctx, 388, 282, 348, 54, "rgba(91,81,76,0.30)", 13, 5);

    fill(ctx, 404, 226, 312, 52, PALETTE.marbleDark);
    fill(ctx, 426, 202, 268, 36, PALETTE.marbleMid);
    poly(ctx, [[392, 202], [560, 132], [728, 202]], PALETTE.gold);
    poly(ctx, [[426, 194], [560, 154], [694, 194]], PALETTE.goldLight);
    line(ctx, 412, 202, 708, 202, PALETTE.bronzeDark, 5);

    for (let i = 0; i < 7; i += 1) {
      const x = 438 + i * 39;
      fill(ctx, x + 7, 230, 18, 68, PALETTE.marbleDark);
      fill(ctx, x, 226, 20, 68, PALETTE.marbleLight);
      fill(ctx, x + 15, 226, 5, 68, PALETTE.marbleMid);
      fill(ctx, x - 3, 222, 26, 7, PALETTE.marbleMid);
      fill(ctx, x - 4, 294, 30, 8, PALETTE.marbleDark);
    }

    fill(ctx, cx - 24, 238, 48, 64, PALETTE.ink);
    fill(ctx, cx - 16, 246, 32, 54, PALETTE.bronzeDark);
    fill(ctx, cx - 8, 254, 16, 32, PALETTE.gold);
    fill(ctx, cx - 3, 268, 6, 18, PALETTE.goldLight);

    fill(ctx, cx - 38, 104, 76, 106, PALETTE.marbleDark);
    fill(ctx, cx - 28, 92, 56, 118, PALETTE.marbleMid);
    fill(ctx, cx - 16, 78, 32, 132, PALETTE.marbleLight);
    dither(ctx, cx - 30, 88, 60, 114, "rgba(91,81,76,0.34)", 11, 2);
    poly(ctx, [[cx - 42, 92], [cx, 30], [cx + 42, 92]], PALETTE.gold);
    poly(ctx, [[cx - 22, 76], [cx, 42], [cx + 22, 76]], PALETTE.goldLight);

    const beamH = 54 + beacon * 1.8;
    const beamAlpha = 0.42 + Math.sin(t * 3.2) * 0.08;
    fill(ctx, cx - 5, 32 - beamH, 10, beamH, "rgba(82, 216, 210, " + beamAlpha.toFixed(2) + ")");
    fill(ctx, cx - 19, 42, 38, 38, "rgba(82, 216, 210, 0.20)");
    fill(ctx, cx - 6, 54, 12, 12, PALETTE.aether);
    fill(ctx, cx - 2, 50, 4, 20, PALETTE.white);
  }

  function drawLandmarks(ctx, t) {
    drawGateway(ctx, 228, 350, "Hermes gateway", PALETTE.aether, t);
    drawGateway(ctx, 890, 350, "Iris relay", "#bd7cff", t + 0.5);
    drawArchive(ctx, 198, 258);
    drawForge(ctx, 872, 272, t);
    drawWatchtower(ctx, 82, 304, t);
    drawSundial(ctx, 976, 294, t);

    drawTorch(ctx, 312, 360, t);
    drawTorch(ctx, 808, 360, t + 0.4);
    drawLaurel(ctx, 156, 414);
    drawLaurel(ctx, 946, 414);
  }

  function drawGateway(ctx, x, y, _label, color, t) {
    fill(ctx, x - 28, y - 68, 56, 74, PALETTE.marbleDark);
    fill(ctx, x - 18, y - 58, 36, 64, PALETTE.void);
    fill(ctx, x - 12, y - 50, 24, 52, "rgba(82,216,210,0.22)");
    fill(ctx, x - 38, y - 76, 76, 12, PALETTE.gold);
    fill(ctx, x - 34, y + 6, 68, 10, PALETTE.marbleMid);
    for (let i = 0; i < 4; i += 1) {
      fill(ctx, x - 9 + i * 6, y - 40 + ((t * 14 + i * 17) % 42), 3, 8, color);
    }
  }

  function drawArchive(ctx, x, y) {
    fill(ctx, x - 52, y + 46, 104, 18, PALETTE.marbleDark);
    fill(ctx, x - 42, y, 84, 50, PALETTE.marbleMid);
    fill(ctx, x - 54, y - 18, 108, 20, PALETTE.gold);
    for (let i = 0; i < 5; i += 1) {
      fill(ctx, x - 32 + i * 16, y + 8, 10, 30, i % 2 ? PALETTE.marbleLight : PALETTE.cloudLight);
      fill(ctx, x - 30 + i * 16, y + 14, 6, 3, PALETTE.bronze);
      fill(ctx, x - 30 + i * 16, y + 24, 6, 3, PALETTE.bronze);
    }
  }

  function drawForge(ctx, x, y, t) {
    fill(ctx, x - 50, y + 52, 100, 16, PALETTE.bronzeDark);
    fill(ctx, x - 42, y + 12, 84, 44, PALETTE.bronze);
    fill(ctx, x - 34, y - 12, 68, 24, PALETTE.marbleDark);
    fill(ctx, x - 18, y + 20, 36, 26, PALETTE.void);
    fill(ctx, x - 10, y + 26, 20, 14, Math.sin(t * 8) > 0 ? PALETTE.goldLight : PALETTE.danger);
    fill(ctx, x + 30, y + 34, 34, 10, PALETTE.marbleCut);
    fill(ctx, x + 40, y + 24, 12, 20, PALETTE.marbleCut);
  }

  function drawWatchtower(ctx, x, y, t) {
    fill(ctx, x - 24, y + 52, 48, 14, PALETTE.marbleDark);
    fill(ctx, x - 18, y - 8, 36, 64, PALETTE.marbleMid);
    fill(ctx, x - 26, y - 30, 52, 24, PALETTE.gold);
    for (let i = 0; i < 3; i += 1) {
      fill(ctx, x - 15 + i * 14, y - 21, 8, 8, Math.sin(t * 2 + i) > -0.3 ? PALETTE.aether : PALETTE.night);
    }
    line(ctx, x, y - 32, x, y - 62, PALETTE.goldLight, 3);
    fill(ctx, x - 9, y - 64, 18, 10, PALETTE.aether);
  }

  function drawSundial(ctx, x, y, t) {
    fill(ctx, x - 42, y + 54, 84, 14, PALETTE.marbleDark);
    fill(ctx, x - 34, y + 16, 68, 40, PALETTE.marbleMid);
    poly(ctx, [[x - 30, y + 16], [x, y - 18], [x + 30, y + 16]], PALETTE.gold);
    for (let i = 0; i < 6; i += 1) {
      const a = -Math.PI * 0.9 + i * 0.36;
      line(ctx, x, y + 14, x + Math.cos(a) * 28, y + 14 + Math.sin(a) * 20, PALETTE.bronzeDark, 2);
    }
    line(ctx, x, y + 12, x + Math.cos(t * 0.7) * 32, y + 12 + Math.sin(t * 0.7) * 18, PALETTE.void, 3);
  }

  function drawTorch(ctx, x, y, t) {
    fill(ctx, x - 3, y - 34, 6, 34, PALETTE.bronzeDark);
    fill(ctx, x - 8, y - 40, 16, 8, PALETTE.bronze);
    fill(ctx, x - 8, y - 56 + Math.sin(t * 10) * 2, 16, 18, PALETTE.danger);
    fill(ctx, x - 4, y - 54, 8, 14, PALETTE.goldLight);
  }

  function drawLaurel(ctx, x, y) {
    for (let i = 0; i < 8; i += 1) {
      fill(ctx, x + i * 7, y - Math.sin(i) * 8, 8, 4, PALETTE.laurel);
      fill(ctx, x + i * 7, y + 8 + Math.sin(i) * 8, 8, 4, PALETTE.laurel);
    }
    line(ctx, x - 2, y + 5, x + 62, y + 5, PALETTE.marbleDark, 2);
  }

  function drawCharacter(ctx, person, x, y, index, t) {
    const key = roleKey(person);
    const color = stateMaterial(person && person.state);
    const bob = Math.sin(t * 2.4 + index) > 0.65 ? -2 : 0;
    const px = Math.round(x);
    const py = Math.round(y + bob);
    const scale = 1.35;

    ctx.save();
    ctx.translate(px, py);
    ctx.scale(scale, scale);

    function r(x1, y1, w, h, c) {
      fill(ctx, x1, y1, w, h, c);
    }

    function l(x1, y1, x2, y2, c, w) {
      line(ctx, x1, y1, x2, y2, c, w);
    }

    r(-17, 36, 34, 7, "rgba(8,7,11,0.45)");
    r(-17, 31, 34, 6, color);
    r(-10, 10, 20, 30, key.includes("hephaestus") ? PALETTE.bronze : color);
    r(-15, 20, 7, 17, PALETTE.skin);
    r(8, 20, 7, 17, PALETTE.skin);
    r(-10, -5, 20, 18, PALETTE.skin);
    r(-5, 2, 4, 4, PALETTE.ink);
    r(3, 2, 4, 4, PALETTE.ink);
    r(-5, 10, 10, 3, PALETTE.bronzeDark);
    r(-8, 39, 7, 11, PALETTE.ink);
    r(1, 39, 7, 11, PALETTE.ink);

    if (key.includes("hermes")) {
      r(-13, -11, 26, 8, PALETTE.goldLight);
      r(-25, -15, 14, 7, PALETTE.white);
      r(11, -15, 14, 7, PALETTE.white);
      l(20, 18, 29, 42, PALETTE.goldLight, 3);
      r(25, 17, 9, 9, PALETTE.aether);
    } else if (key.includes("athena")) {
      r(-12, -13, 24, 9, PALETTE.marbleCut);
      r(-3, -25, 7, 13, PALETTE.gold);
      r(-28, 16, 16, 24, PALETTE.gold);
      l(23, -8, 23, 42, PALETTE.marbleLight, 3);
    } else if (key.includes("hephaestus")) {
      l(-22, 8, -38, -12, PALETTE.marbleCut, 5);
      r(-44, -19, 18, 11, PALETTE.marbleCut);
      r(17, 34, 22, 8, PALETTE.marbleCut);
    } else if (key.includes("apollo")) {
      for (let i = 0; i < 8; i += 1) {
        const a = (Math.PI * 2 * i) / 8;
        l(0, -5, Math.cos(a) * 24, -5 + Math.sin(a) * 24, PALETTE.goldLight, 2);
      }
      r(17, 16, 13, 22, PALETTE.gold);
      l(19, 18, 28, 36, PALETTE.bronzeDark, 2);
    } else if (key.includes("mnemosyne")) {
      r(15, 16, 22, 20, PALETTE.cloudLight);
      l(19, 21, 32, 21, PALETTE.bronze, 2);
      l(19, 28, 31, 28, PALETTE.bronze, 2);
    } else if (key.includes("argus")) {
      r(-19, -20, 38, 10, PALETTE.gold);
      for (let i = 0; i < 3; i += 1) r(-13 + i * 10, -17, 6, 6, PALETTE.aether);
    } else if (key.includes("iris")) {
      r(-15, 14, 5, 30, "#db6657");
      r(-9, 14, 5, 30, PALETTE.gold);
      r(-3, 14, 5, 30, PALETTE.ok);
      r(3, 14, 5, 30, PALETTE.aether);
      r(9, 14, 5, 30, "#bd7cff");
    } else if (key.includes("chronos")) {
      r(17, 10, 20, 32, PALETTE.gold);
      r(21, 15, 12, 9, PALETTE.aether);
      r(21, 30, 12, 8, PALETTE.warning);
      l(19, 25, 35, 25, PALETTE.bronzeDark, 2);
    } else {
      r(-13, -11, 26, 7, PALETTE.gold);
      r(15, 18, 16, 16, color);
    }

    ctx.restore();

    drawTinyLabel(ctx, person && person.name ? person.name : roleShort(person), px, py + 62, color);

    if (key.includes("hermes")) {
      for (let i = 0; i < 3; i += 1) {
        const travel = (t * 42 + i * 28) % 84;
        fill(ctx, px + 44 + travel, py + 21 - i * 7, 8, 5, i % 2 ? PALETTE.aether : PALETTE.goldLight);
      }
    } else if (key.includes("athena")) {
      fill(ctx, px - 52, py + 42, 36, 24, "rgba(8,7,11,0.72)");
      fill(ctx, px - 48, py + 46, 28, 3, color);
      fill(ctx, px - 48, py + 54, 20, 3, PALETTE.marbleLight);
      fill(ctx, px - 48, py + 61, 14, 3, PALETTE.marbleMid);
    } else if (key.includes("hephaestus")) {
      for (let i = 0; i < 4; i += 1) {
        fill(ctx, px - 58 + i * 8, py - 8 - ((t * 18 + i * 9) % 22), 4, 4, i % 2 ? PALETTE.goldLight : PALETTE.danger);
      }
    } else if (key.includes("apollo")) {
      line(ctx, px - 12, py - 30, px - 68, py - 70, "rgba(255,226,141,0.44)", 2);
      fill(ctx, px - 72, py - 74, 10, 10, PALETTE.goldLight);
    } else if (key.includes("mnemosyne")) {
      for (let i = 0; i < 3; i += 1) {
        fill(ctx, px + 42 + i * 12, py + 38 - i * 4, 9, 13, PALETTE.cloudLight);
        line(ctx, px + 44 + i * 12, py + 43 - i * 4, px + 49 + i * 12, py + 43 - i * 4, PALETTE.bronze, 1);
      }
    } else if (key.includes("argus")) {
      line(ctx, px, py - 30, px + 72, py - 86 + Math.sin(t) * 10, "rgba(82,216,210,0.40)", 4);
      fill(ctx, px + 68, py - 90 + Math.sin(t) * 10, 14, 8, PALETTE.aether);
    } else if (key.includes("iris")) {
      for (let i = 0; i < 5; i += 1) {
        fill(ctx, px - 72 + i * 14 + ((t * 20) % 12), py + 32 - i * 4, 12, 4, ["#db6657", PALETTE.gold, PALETTE.ok, PALETTE.aether, "#bd7cff"][i]);
      }
    } else if (key.includes("chronos")) {
      for (let i = 0; i < 4; i += 1) {
        fill(ctx, px - 44 + i * 11, py - 26, 5, 5, (Math.sin(t * 3 + i) > 0 ? PALETTE.warning : PALETTE.marbleDark));
      }
    } else {
      fill(ctx, px + 42, py + 28, 16, 10, color);
    }
  }

  function drawOlympusWorld(ctx, figures, score, t) {
    ctx.imageSmoothingEnabled = false;
    drawBackground(ctx, t);
    drawTerraces(ctx, t);
    drawLandmarks(ctx, t);
    drawTemple(ctx, score, t);

    const fallback = [
      { name: "Hermes", role: "routing", state: "active" },
      { name: "Athena", role: "review", state: "ok" },
      { name: "Hephaestus", role: "tools", state: "warning" },
      { name: "Apollo", role: "cron", state: "scheduled" },
      { name: "Mnemosyne", role: "memory", state: "active" },
      { name: "Argus", role: "watchtower", state: "checking" },
      { name: "Iris", role: "gateway", state: "running" },
      { name: "Chronos", role: "freshness", state: "warning" },
    ];
    const cast = (figures.length ? figures : fallback).slice(0, 8);
    const positions = [
      [250, 426], [370, 392], [826, 410], [680, 372],
      [192, 348], [92, 378], [904, 388], [986, 380],
    ];
    cast.forEach((person, index) => {
      drawCharacter(ctx, person, positions[index][0], positions[index][1], index, t);
    });

    fill(ctx, 24, 504, 346, 24, "rgba(8,7,11,0.60)");
    fill(ctx, 32, 512, clamp(score || 0, 0, 100) * 3, 8, score >= 80 ? PALETTE.ok : score >= 55 ? PALETTE.warning : PALETTE.danger);
    fill(ctx, 32, 522, 312, 2, PALETTE.marbleDark);
  }

  function OlympusScene({ pantheon, score }) {
    const canvasRef = useRef(null);
    const figures = useMemo(() => asList(pantheon).slice(0, 8), [pantheon]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return undefined;
      const ctx = canvas.getContext("2d");
      let raf = 0;
      const start = performance.now();

      function frame(now) {
        drawOlympusWorld(ctx, figures, score, (now - start) / 1000);
        raf = requestAnimationFrame(frame);
      }

      frame(start);
      return () => cancelAnimationFrame(raf);
    }, [figures, score]);

    return el("section", { className: "olympus-map", "aria-label": "Olympus operations map" },
      el("canvas", {
        ref: canvasRef,
        className: "olympus-scene-canvas",
        width: WORLD_W,
        height: WORLD_H,
        role: "img",
        "aria-label": "Detailed Mount Olympus operations scene with agent roles, route gates, review tower, memory archive, forge, cron sundial, and tuning beacon."
      }),
      el("div", { className: "olympus-scene-a11y" },
        figures.map((p, idx) => el("span", { key: (p.name || "agent") + idx }, [p.name, p.role, p.state].filter(Boolean).join(" - ")))
      )
    );
  }

  function AgentHQ({ hq }) {
    const data = hq || {};
    const summary = data.summary || {};
    const agents = asList(data.agents);
    const opportunities = asList(data.opportunities);
    const cost = Number(summary.total_cost_usd || 0);
    const tiles = [
      { label: "Agents", value: summary.agents || agents.length || 0, state: agents.length ? "active" : "unknown" },
      { label: "Opportunities", value: summary.opportunities || opportunities.length || 0, state: opportunities.length ? "warning" : "ok" },
      { label: "Spend (window)", value: "$" + cost.toFixed(2), state: cost > 0 ? "active" : "idle" },
      { label: "Looping", value: summary.looping_sessions || 0, state: summary.looping_sessions ? "warning" : "ok" },
      { label: "Context Pressure", value: summary.context_pressure_sessions || 0, state: summary.context_pressure_sessions ? "warning" : "ok" },
      { label: "Active Sessions", value: summary.active_sessions || 0, state: summary.active_sessions ? "active" : "idle" },
      { label: "Tool Heavy", value: summary.tool_heavy_sessions || 0, state: summary.tool_heavy_sessions ? "warning" : "ok" },
      { label: "Long Threads", value: summary.long_threads || 0, state: summary.long_threads ? "warning" : "ok" },
      { label: "Kanban Open", value: summary.kanban_open || 0, state: summary.kanban_open ? "active" : "idle" },
    ];

    return el("section", { className: "olympus-section olympus-agent-hq" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Optimization Queue"),
          el("p", null, "Ranked tuning moves for agents, routes, skills, memory, schedules, tools, and Kanban work.")
        )
      ),
      el("div", { className: "olympus-hq-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-hq-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(StatePill, { state: item.state })
        ))
      ),
      el("div", { className: "olympus-hq-grid" },
        el("div", { className: "olympus-hq-pane olympus-hq-opportunities" },
          el("h3", null, "What To Tune"),
          opportunities.length ? opportunities.map((item, idx) => el("article", { key: idx, className: cx("olympus-opportunity", "olympus-opportunity-" + String(item.severity || "info").toLowerCase()) },
            el("div", { className: "olympus-opportunity-head" },
              el("div", null,
                el("span", null, "Tune " + String(item.kind || "agent")),
                el("h4", null, item.title || "Opportunity")
              ),
              el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
            ),
            el("p", null, item.detail || ""),
            (item.evidence || item.threshold || item.basis) ? el("details", { className: "olympus-details" },
              el("summary", null, "Evidence"),
              item.evidence ? el("small", null, "Observed: " + item.evidence) : null,
              item.threshold ? el("small", { className: "olympus-threshold" }, "Trigger: " + item.threshold) : null,
              item.basis ? el("small", { className: "olympus-basis" }, item.basis) : null
            ) : null,
            item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || "Open view") : null
          )) : el("p", { className: "olympus-muted" }, "No improvement opportunities detected.")
        ),
        el("div", { className: "olympus-hq-pane" },
          el("h3", null, "Agent Readiness"),
          agents.length ? agents.map((agent) => {
            const k = agent.kanban || {};
            return el("div", { key: agent.id || agent.label, className: "olympus-agent-row" },
              el("div", null,
                el("strong", null, agent.label || "Agent"),
                el("small", null, [agent.model || "route unset", (agent.skill_count || 0) + " skills", (agent.cron_jobs || 0) + " cron"].join(" / "))
              ),
              el("div", { className: "olympus-agent-metrics" },
                el("span", null, (k.open || 0) + " open"),
                el("span", null, (k.ready || 0) + " ready"),
                el("span", null, (k.running || 0) + " running"),
                el("span", null, (k.blocked || 0) + " blocked")
              ),
              el("div", { className: "olympus-flags" },
                asList(agent.flags).map((flag) => el("span", { key: flag }, flag))
              )
            );
          }) : el("p", { className: "olympus-muted" }, "No agent profiles detected.")
        )
      )
    );
  }

  function KanbanIntelligence({ kanban }) {
    const data = kanban || {};
    const totals = data.totals || {};
    const boards = asList(data.boards);
    const attention = asList(data.attention);
    const assignees = asList(data.assignee_load);
    const workers = asList(data.active_workers);
    const totalBoards = boards.length;
    const open = Number(data.open || 0);
    const blocked = Number(totals.blocked || 0);
    const ready = Number(totals.ready || 0);

    const summary = [
      { label: "Boards", value: String(totalBoards), state: totalBoards ? "active" : "unknown" },
      { label: "Open Work", value: String(open), state: open ? "active" : "idle" },
      { label: "Ready", value: String(ready), state: ready ? "running" : "idle" },
      { label: "Blocked", value: String(blocked), state: blocked ? "warning" : "ok" },
      { label: "Workers", value: String(workers.length), state: workers.length ? "running" : "idle" },
    ];

    return el("section", { className: "olympus-section olympus-kanban" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Kanban Intelligence"),
          el("p", null, "Read-only orchestration health: board pressure, blocked work, worker activity, and assignee load.")
        ),
        el("a", { className: "olympus-link", href: "/kanban" }, "Open Kanban")
      ),
      el("div", { className: "olympus-kanban-summary" },
        summary.map((item) => el("div", { key: item.label, className: "olympus-kanban-tile" },
          el("span", null, item.label),
          el("strong", null, item.value),
          el(StatePill, { state: item.state })
        ))
      ),
      el("div", { className: "olympus-kanban-grid" },
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Boards"),
          boards.length ? boards.map((board) => el("div", { key: board.slug, className: "olympus-mini-row" },
            el("span", null, (board.name || board.slug) + (board.is_current ? " / current" : "")),
            el("small", null, [
              (board.open || 0) + " open",
              (board.counts && board.counts.running || 0) + " running",
              (board.counts && board.counts.blocked || 0) + " blocked"
            ].join(" / ")),
            el(StatePill, { state: board.error ? "warning" : (board.open ? "active" : "idle") })
          )) : el("p", { className: "olympus-muted" }, "No Kanban boards detected.")
        ),
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Assignee Load"),
          assignees.length ? assignees.slice(0, 6).map((agent) => el("div", { key: agent.assignee, className: "olympus-mini-row" },
            el("span", null, agent.assignee || "unassigned"),
            el("small", null, [
              (agent.open || 0) + " open",
              (agent.running || 0) + " running",
              (agent.ready || 0) + " ready",
              (agent.blocked || 0) + " blocked"
            ].join(" / ")),
            el(StatePill, { state: Number(agent.blocked || 0) ? "warning" : Number(agent.running || 0) ? "running" : "active" })
          )) : el("p", { className: "olympus-muted" }, "No assigned Kanban work right now.")
        ),
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Kanban Attention"),
          attention.length ? attention.slice(0, 6).map((item, idx) => el("div", { key: idx, className: "olympus-mini-row" },
            el("span", null, item.label || "Kanban issue"),
            el("small", null, [item.board, item.detail].filter(Boolean).join(" / ")),
            el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
          )) : el("p", { className: "olympus-muted" }, "No blocked, stale, failed, or unassigned Kanban work detected.")
        )
      )
    );
  }

  function ProfileMatrix({ profiles }) {
    const list = asList(profiles);
    return el("section", { className: "olympus-section" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Profile Tuning Matrix"),
          el("p", null, "A compact profile comparison for runtime route, skill, gateway, and trust-boundary tuning.")
        )
      ),
      list.length ? el("div", { className: "olympus-profile-table" },
        list.map((p) => el("article", { key: p.id || p.label, className: "olympus-profile-row" },
          el("div", null,
            el("strong", null, p.label || "Profile"),
            el("span", null, p.trust_boundary || "unknown")
          ),
          el("div", null,
            el("small", null, "Route"),
            el("span", null, p.model || "unset")
          ),
          el("div", null,
            el("small", null, "Skills"),
            el("span", null, String(p.skill_count || 0))
          ),
          el("div", null,
            el("small", null, "Gateway"),
            el(StatePill, { state: p.gateway_state || "unknown" })
          ),
          el("div", { className: "olympus-flags" },
            asList(p.tuning_flags).map((flag) => el("span", { key: flag }, flag))
          )
        ))
      ) : el("p", { className: "olympus-muted" }, "No profiles detected.")
    );
  }

  function WorkEvidence({ sessions, cron, attention }) {
    const recentSessions = asList(sessions).slice(0, 5);
    const cronJobs = asList(cron).slice(0, 5);
    const findings = asList(attention).slice(0, 5);
    return el("section", { className: "olympus-section" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Evidence Rail"),
          el("p", null, "Small read-only slices of the data behind the tuning queue.")
        )
      ),
      el("div", { className: "olympus-evidence-grid" },
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Recent Work"),
          recentSessions.length ? recentSessions.map((s) => el("div", { key: s.id, className: "olympus-mini-row" },
            el("span", null, s.label || s.session_id),
            el("small", null, [
              s.model || "route unset",
              (s.tool_call_count || 0) + " tools",
              (s.message_count || 0) + " msgs",
              s.cost_usd ? "$" + Number(s.cost_usd).toFixed(2) : null,
              s.total_tokens ? Number(s.total_tokens).toLocaleString() + " tok" : null
            ].filter(Boolean).join(" / ")),
            el(StatePill, { state: s.state })
          )) : el("p", { className: "olympus-muted" }, "No recent sessions detected.")
        ),
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Schedule Pressure"),
          cronJobs.length ? cronJobs.map((j) => el("div", { key: j.id, className: "olympus-mini-row" },
            el("span", null, j.label || j.job_id),
            el("small", null, [j.schedule, j.profile].filter(Boolean).join(" / ") || "no schedule"),
            el(StatePill, { state: j.state })
          )) : el("p", { className: "olympus-muted" }, "No cron jobs detected.")
        ),
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Watchtower"),
          findings.length ? findings.map((item, idx) => el("div", { key: idx, className: "olympus-mini-row" },
            el("span", null, item.label || "Finding"),
            el("small", null, item.detail || "no detail"),
            el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
          )) : el("p", { className: "olympus-muted" }, "No current attention items.")
        )
      )
    );
  }

  function OlympusPage() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    function load() {
      setLoading(true);
      SDK.fetchJSON(API + "/overview?ts=" + encodeURIComponent(String(Date.now())))
        .then((next) => { setData(next); setError(null); })
        .catch((err) => setError(String(err && err.message ? err.message : err)))
        .finally(() => setLoading(false));
    }

    useEffect(() => {
      load();
      const id = setInterval(load, 10000);
      return () => clearInterval(id);
    }, []);

    const health = (data && data.health) || {};
    const tuning = (data && data.tuning) || {};
    const score = typeof tuning.score === "number" ? tuning.score : 0;

    return el("div", { className: "olympus-page" },
      el(Hero, { health, score, loading, onRefresh: load }),
      error ? el("div", { className: "olympus-error" }, error) : null,
      el(AgentHQ, { hq: tuning.agent_hq }),
      el(KanbanIntelligence, { kanban: data && data.kanban }),
      el(ProfileMatrix, { profiles: tuning.profiles }),
      el(ScoreExplainer, { tuning }),
      el("div", { className: "olympus-topology" },
        el(OlympusScene, { pantheon: tuning.pantheon, score })
      ),
      el(WorkEvidence, { sessions: data && data.sessions, cron: data && data.cron, attention: data && data.attention })
    );
  }

  window.__HERMES_PLUGINS__.register("olympus", OlympusPage);
})();
