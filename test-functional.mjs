#!/usr/bin/env node
/**
 * Comprehensive functional test for gsd-mcp-server.
 * Creates a real GSD project in /tmp, spawns the MCP server,
 * and tests every tool with meaningful output assertions.
 */
import { spawn, execFileSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const TMP = "/tmp/gsd-mcp-test-" + Date.now();
const PLANNING = join(TMP, ".planning");
const GSD_BIN = join(process.env.HOME, ".config/opencode/get-shit-done/bin/gsd-tools.cjs");
const SERVER_PATH = join(import.meta.dirname, "index.js");

// ── Helpers ──────────────────────────────────────────

let msgId = 0;
const pending = new Map();
let passed = 0, failed = 0;
let server, proc;

function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS | ${name}`); }
  else { failed++; console.log(`  FAIL | ${name}${detail ? " " + detail : ""}`); }
}

function isError(res) {
  return !!(res.error || res.result?.isError);
}

function hasContent(res) {
  return res.result?.content?.[0]?.text?.length > 0;
}

// ── Test project setup ───────────────────────────────

function setupProject() {
  mkdirSync(PLANNING, { recursive: true });

  // config.json
  const cfg = JSON.parse(readFileSync(join(process.env.HOME, ".config/opencode/get-shit-done/templates/config.json"), "utf-8"));
  writeFileSync(join(PLANNING, "config.json"), JSON.stringify(cfg, null, 2));

  // STATE.md
  writeFileSync(join(PLANNING, "STATE.md"), `# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-08)

**Core value:** Test GSD MCP tools
**Current focus:** Functional testing

## Current Position

Phase: 1 of 2 (Setup)
Plan: 1 of 1 in current phase
Status: Ready to plan
Last activity: 2026-06-08 — Created test project

## Phases

- Phase 1: Setup — Initialize test infrastructure
- Phase 2: Testing — Run functional tests

## Next Steps

1. Plan phase 1
2. Execute phase 1
3. Verify phase 1

## Active Decisions

- Use MCP for all GSD interactions

## Blockers

None

## Metrics

\`\`\`json
{}
\`\`\`

## Session

- 2026-06-08: Created test project
`);

  // ROADMAP.md
  writeFileSync(join(PLANNING, "ROADMAP.md"), `# Roadmap: GSD MCP Test

## Overview

Test all MCP tools against a real GSD project.

## Phases

- [ ] **Phase 1: Setup** - Initialize test infrastructure
- [ ] **Phase 2: Testing** - Run functional tests

## Success Criteria

1. All tools respond without crashes
2. Outputs have expected structure
3. State transitions work correctly
`);

  // PROJECT.md
  writeFileSync(join(PLANNING, "PROJECT.md"), `# GSD MCP Functional Test

## What This Is

A temporary project to validate all gsd-mcp-server tools against real GSD infrastructure.

## Core Value

Reliable MCP-GSD integration
`);

  // REQUIREMENTS.md
  writeFileSync(join(PLANNING, "REQUIREMENTS.md"), `# Requirements

- [ ] REQ-01: All 34 tools respond successfully
- [ ] REQ-02: All 6 resources return valid content
- [ ] REQ-03: Zod validation rejects bad inputs
`);

  // Init git repo
  execFileSync("git", ["init"], { cwd: TMP, encoding: "utf-8" });
  execFileSync("git", ["config", "user.email", "test@gsd-mcp-server"], { cwd: TMP, encoding: "utf-8" });
  execFileSync("git", ["config", "user.name", "GSD MCP Test"], { cwd: TMP, encoding: "utf-8" });
  execFileSync("git", ["add", "-A"], { cwd: TMP, encoding: "utf-8" });
  execFileSync("git", ["commit", "-m", "Initial test project"], { cwd: TMP, encoding: "utf-8" });

  // Verify GSD tools work
  const check = execFileSync("node", [GSD_BIN, "progress", "--raw"], { cwd: TMP, encoding: "utf-8", timeout: 10000 });
  if (!check) throw new Error("GSD tools not working on test project");
}

function connectServer() {
  return new Promise((resolve) => {
    proc = spawn("node", [SERVER_PATH], {
      stdio: ["pipe", "pipe", "inherit"],
      cwd: import.meta.dirname,
      env: { ...process.env, GSD_WORKSTREAM: "" },
    });

    const send = (method, params = {}) => {
      const id = ++msgId;
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return new Promise((r) => pending.set(id, r));
    };

    let buf = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const r = pending.get(msg.id);
          if (r) { pending.delete(msg.id); r(msg); }
        } catch { /* partial */ }
      }
    });

    proc.on("spawn", async () => {
      await new Promise((r) => setTimeout(r, 300));
      await send("initialize", {
        protocolVersion: "2024-11-05", capabilities: {},
        clientInfo: { name: "func-test", version: "1.0.0" },
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      await new Promise((r) => setTimeout(r, 100));
      server = { send, close: () => { proc.stdin.end(); proc.kill(); } };
      resolve();
    });
  });
}

async function call(name, args = {}) {
  return await server.send("tools/call", { name, arguments: args });
}

// ── Main ─────────────────────────────────────────────

async function main() {
  console.log("\n==============================================");
  console.log("  FUNCTIONAL TEST: Creating GSD project...");
  console.log("==============================================\n");

  try { setupProject(); } catch (e) {
    console.error("SETUP FAILED:", e.message);
    process.exit(1);
  }
  console.log(`  Project at: ${TMP}\n`);

  await connectServer();
  console.log("  MCP server connected\n");

  // Force server CWD to our test project by calling a command that uses gsd-tools
  // The server process stays in its own dir, but gsd-tools finds .planning via parent walk.
  // We set up the test project in a parent of CWD... actually gsd-tools walks UP from CWD.
  // Since server CWD is /home/md/src/mcp/gsd-mcp-server, it won't find /tmp/...
  // We need to solve this differently.

  // TODO: The server uses process.cwd() which is its own dir.
  // We can't change the server's CWD after it's spawned.
  // The gsd() function in the server calls execFileSync with no cwd option,
  // so it inherits the server's CWD. gsd-tools.cjs then resolves project root
  // by walking UP from CWD.
  //
  // Option 1: Spawn server with cwd = TMP
  // Option 2: Use --cwd flag passed to gsd-tools
  //
  // Let's restart with cwd = TMP.

  server.close();
  await new Promise((r) => setTimeout(r, 200));
  msgId = 0;

  console.log("  Restarting server with CWD = test project...\n");

  // Re-spawn with correct CWD
  proc = spawn("node", [SERVER_PATH], {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: TMP,
    env: { ...process.env, GSD_WORKSTREAM: "" },
  });

  const send = (method, params = {}) => {
    const id = ++msgId;
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((r) => pending.set(id, r));
  };

  let buf = "";
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const r = pending.get(msg.id);
        if (r) { pending.delete(msg.id); r(msg); }
      } catch { /* partial */ }
    }
  });

  await new Promise((r) => setTimeout(r, 300));
  await send("initialize", {
    protocolVersion: "2024-11-05", capabilities: {},
    clientInfo: { name: "func-test", version: "1.0.0" },
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await new Promise((r) => setTimeout(r, 100));
  server.send = send;
  server.close = () => { proc.stdin.end(); proc.kill(); };

  // ── PHASE 1: Core tools ──────────────────────────────

  console.log("\n=== CORE TOOLS ===\n");

  // gsd_state
  let r = await call("gsd_state");
  check("gsd_state no error", !isError(r));
  check("gsd_state shows project name", r.result?.content?.[0]?.text?.includes("GSD MCP Functional Test"));

  // gsd_progress
  r = await call("gsd_progress");
  check("gsd_progress no error", !isError(r));
  check("gsd_progress shows roadmap", r.result?.content?.[0]?.text?.includes("## Roadmap"));

  // gsd_list_phases
  r = await call("gsd_list_phases");
  check("gsd_list_phases no error", !isError(r));
  check("gsd_list_phases has phases", r.result?.content?.[0]?.text?.includes("Phase 1"));

  // ── PHASE 2: gsd_validate ────────────────────────────

  console.log("\n=== VALIDATE ===\n");

  r = await call("gsd_validate", { check: "health" });
  check("gsd_validate health no error", !isError(r));
  const hText = r.result?.content?.[0]?.text;
  check("gsd_validate health output", hText?.length > 0);
  check("gsd_validate health structured", hText?.includes("{") || hText?.includes("ok") || hText?.includes("health"));

  r = await call("gsd_validate", { check: "consistency" });
  check("gsd_validate consistency no error", !isError(r));
  check("gsd_validate consistency output", r.result?.content?.[0]?.text?.length > 0);

  r = await call("gsd_validate", { check: "agents" });
  check("gsd_validate agents no error", !isError(r));
  check("gsd_validate agents output", r.result?.content?.[0]?.text?.length > 0);

  r = await call("gsd_validate", { check: "health", repair: true });
  check("gsd_validate health+repair no error", !isError(r));

  // ── PHASE 3: gsd_config_get / gsd_config_set ─────────

  console.log("\n=== CONFIG ===\n");

  r = await call("gsd_config_get", { key: "mode" });
  check("gsd_config_get no error", !isError(r));
  check("gsd_config_get has value", r.result?.content?.[0]?.text?.length > 3);
  check("gsd_config_get correct value", r.result?.content?.[0]?.text?.includes("interactive"));

  r = await call("gsd_config_set", { key: "mode", value: '"budget"' });
  check("gsd_config_set no error", !isError(r));

  r = await call("gsd_config_get", { key: "mode" });
  check("gsd_config_get sees new value", r.result?.content?.[0]?.text?.includes("budget"));

  // ── PHASE 4: gsd_roadmap_analyze ──────────────────────

  console.log("\n=== ROADMAP ===\n");

  r = await call("gsd_roadmap_analyze");
  check("gsd_roadmap_analyze no error", !isError(r));
  const rText = r.result?.content?.[0]?.text;
  check("gsd_roadmap_analyze output length", rText?.length > 20);
  // Should contain phase info
  check("gsd_roadmap_analyze has phases", rText?.includes("Phase") || rText?.includes("phase") || rText?.includes("total"));

  // ── PHASE 5: gsd_scaffold ─────────────────────────────

  console.log("\n=== SCAFFOLD ===\n");

  // Phase dir must exist before scaffold, named in GSD convention: 01-<slug>
  mkdirSync(join(PLANNING, "phases", "01-Setup"), { recursive: true });

  r = await call("gsd_scaffold", { type: "context", phase: 1 });
  check("gsd_scaffold context no error", !isError(r));
  const phaseDir = join(PLANNING, "phases", "01-Setup");
  const ctxPath = join(phaseDir, "01-CONTEXT.md");
  check("gsd_scaffold context file exists", existsSync(ctxPath));

  r = await call("gsd_scaffold", { type: "uat", phase: 1 });
  check("gsd_scaffold uat no error", !isError(r));
  const uatPath = join(phaseDir, "01-UAT.md");
  check("gsd_scaffold uat file exists", existsSync(uatPath));

  r = await call("gsd_scaffold", { type: "verification", phase: 1 });
  check("gsd_scaffold verification no error", !isError(r));
  const verPath = join(phaseDir, "01-VERIFICATION.md");
  check("gsd_scaffold verification file exists", existsSync(verPath));

  r = await call("gsd_scaffold", { type: "phase-dir", phase: 1, name: "functional-test" });
  check("gsd_scaffold phase-dir no error", !isError(r) || r.result?.content?.[0]?.text?.includes("exists"));

  // ── PHASE 6: gsd_commit ──────────────────────────────

  console.log("\n=== COMMIT ===\n");

  r = await call("gsd_commit", { message: "test: functional check" });
  check("gsd_commit no error", !isError(r));
  const cText = r.result?.content?.[0]?.text;
  check("gsd_commit output length", cText?.length > 0);
  // Check git log
  const log = execFileSync("git", ["log", "--oneline", "-1"], { cwd: TMP, encoding: "utf-8" });
  check("gsd_commit actually committed", log.includes("test: functional check"));

  r = await call("gsd_commit", { message: "test with files", files: "STATE.md ROADMAP.md" });
  check("gsd_commit with files no error", !isError(r));

  // ── PHASE 7: gsd_phase_complete ──────────────────────

  console.log("\n=== PHASE COMPLETE ===\n");

  r = await call("gsd_phase_complete", { phase: 1 });
  check("gsd_phase_complete no error", !isError(r));
  const pcText = r.result?.content?.[0]?.text;
  check("gsd_phase_complete output length", pcText?.length > 0);

  // ROADMAP should reflect completion
  const roadmap = readFileSync(join(PLANNING, "ROADMAP.md"), "utf-8");
  check("gsd_phase_complete updated roadmap", roadmap.includes("[x]") || roadmap.includes("[X]"));

  // ── PHASE 8: gsd_audit_uat ─────────────────────────

  console.log("\n=== AUDIT UAT ===\n");

  r = await call("gsd_audit_uat");
  check("gsd_audit_uat no error", !isError(r));
  check("gsd_audit_uat output length", r.result?.content?.[0]?.text?.length > 0);

  // ── PHASE 9: gsd_websearch ──────────────────────────

  console.log("\n=== WEBSEARCH ===\n");

  r = await call("gsd_websearch", { query: "node.js mcp server" });
  check("gsd_websearch no error", !isError(r));
  const wText = r.result?.content?.[0]?.text;
  check("gsd_websearch output length", wText?.length > 10);
  if (wText?.length > 10) {
    check("gsd_websearch structured", wText?.includes("{") || wText?.includes("[") || wText?.includes("result"));
  }

  r = await call("gsd_websearch", { query: "test", limit: 3, freshness: "week" });
  check("gsd_websearch with limit+freshness no error", !isError(r));
  check("gsd_websearch limited results", r.result?.content?.[0]?.text?.length > 10);

  // ── PHASE 10: gsd_todo_complete ──────────────────────

  console.log("\n=== TODO COMPLETE ===\n");

  // Create a todo file in todos/pending/
  const todoDir = join(PLANNING, "todos", "pending");
  mkdirSync(todoDir, { recursive: true });
  writeFileSync(join(todoDir, "test-todo.md"), "- [ ] Review functional test results\n");

  r = await call("gsd_todo_complete", { filename: "test-todo.md" });
  check("gsd_todo_complete no error", !isError(r));
  check("gsd_todo_complete output length", r.result?.content?.[0]?.text?.length > 0);

  // ── PHASE 11: gsd_workstreams ────────────────────────

  console.log("\n=== WORKSTREAMS ===\n");

  r = await call("gsd_workstreams", { action: "list" });
  check("gsd_workstreams list no error", !isError(r));
  check("gsd_workstreams list output", r.result?.content?.[0]?.text?.length > 0);

  r = await call("gsd_workstreams", { action: "create", name: "test-ws" });
  check("gsd_workstreams create no error", !isError(r) || r.result?.content?.[0]?.text?.includes("already") || r.result?.content?.[0]?.text?.includes("exists"));

  r = await call("gsd_workstreams", { action: "status", name: "test-ws" });
  check("gsd_workstreams status no error", !isError(r));

  // ── PHASE 12: Input validation edge cases ─────────────

  console.log("\n=== INPUT VALIDATION ===\n");

  // Re-run edge tests against real project
  r = await call("gsd_validate", { check: "invalid" });
  check("gsd_validate rejects bad check", isError(r));

  r = await call("gsd_phase_complete", { phase: 0 });
  check("gsd_phase_complete rejects phase=0", isError(r));

  r = await call("gsd_config_get", { key: "" });
  check("gsd_config_get rejects empty key", isError(r));

  r = await call("gsd_scaffold", { type: "bad", phase: 1 });
  check("gsd_scaffold rejects bad type", isError(r));

  r = await call("gsd_websearch", { query: "" });
  check("gsd_websearch rejects empty query", isError(r));

  r = await call("gsd_workstreams", { action: "bad" });
  check("gsd_workstreams rejects bad action", isError(r));

  r = await call("gsd_todo_complete", { filename: "" });
  check("gsd_todo_complete rejects empty filename", isError(r));

  r = await call("gsd_commit", { message: "" });
  check("gsd_commit rejects empty message", isError(r));

  // ── Cleanup ──────────────────────────────────────────

  server.close();
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}

  console.log(`\n========================================`);
  console.log(`  Functional Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Functional test error:", e);
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
