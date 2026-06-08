#!/usr/bin/env node
import { spawn } from "child_process";
import { existsSync, rmSync } from "fs";
import { join } from "path";
// Clean up any stale .planning/ from prior runs
const stale = join(import.meta.dirname, ".planning");
if (existsSync(stale)) rmSync(stale, { recursive: true, force: true });

let msgId = 0;
const pending = new Map();

async function main() {
  const proc = spawn("node", ["./index.js"], {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: import.meta.dirname,
  });

  const server = {
    send: (method, params = {}) => {
      const id = ++msgId;
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      return new Promise((resolve) => {
        pending.set(id, resolve);
        proc.stdin.write(msg);
      });
    },
    close: () => {
      proc.stdin.end();
      proc.kill();
    },
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
        const resolve = pending.get(msg.id);
        if (resolve) {
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch { /* ignore partial */ }
    }
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(300);

  let passed = 0;
  let failed = 0;

  function check(name, actual, expected, detail = "") {
    const ok = actual === expected;
    const mark = ok ? "PASS" : "FAIL";
    if (ok) passed++; else failed++;
    console.log(`  ${mark} | ${name}: ${JSON.stringify(actual)} ${ok ? "" : `(expected ${JSON.stringify(expected)}) ${detail}`}`);
    return ok;
  }

  function checkDeep(name, actual, expected, path = "") {
    if (typeof expected === "object" && expected !== null && !Array.isArray(expected)) {
      let ok = true;
      for (const k of Object.keys(expected)) {
        if (!(k in actual)) {
          console.log(`  FAIL | ${name}: missing key ${path}.${k}`);
          failed++;
          ok = false;
          continue;
        }
        if (!checkDeep(`${name}.${k}`, actual[k], expected[k], `${path}.${k}`)) ok = false;
      }
      if (ok) { passed++; console.log(`  PASS | ${name}`); }
      return ok;
    }
    return check(name, actual, expected);
  }

  console.log("\n=== INITIALIZE ===\n");
  const init = await server.send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  });
  check("init.result.serverInfo.name", init.result?.serverInfo?.name, "gsd-mcp-server");
  check("init.result.serverInfo.version", init.result?.serverInfo?.version, "2.0.0");
  check("init.result.capabilities.tools", !!init.result?.capabilities?.tools, true);
  check("init.result.capabilities.resources", !!init.result?.capabilities?.resources, true);

  // Send initialized notification
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  console.log("\n=== RESOURCES/LIST ===\n");
  const resList = await server.send("resources/list");
  const resources = resList.result?.resources || [];
  const resourceUris = resources.map(r => r.uri).sort();
  check("resources/list count", resources.length, 6);
  check("resources uris[0]", resourceUris[0], "gsd://config");
  check("resources uris[1]", resourceUris[1], "gsd://help");
  check("resources uris[2]", resourceUris[2], "gsd://project");
  check("resources uris[3]", resourceUris[3], "gsd://requirements");
  check("resources uris[4]", resourceUris[4], "gsd://roadmap");
  check("resources uris[5]", resourceUris[5], "gsd://state");

  console.log("\n=== RESOURCES/READ ===\n");

  // gsd://help should always work
  const helpRes = await server.send("resources/read", { uri: "gsd://help" });
  check("read help exists", !!helpRes.result?.contents?.[0]?.text, true);

  // gsd://config might return empty JSON
  const configRes = await server.send("resources/read", { uri: "gsd://config" });
  check("read config exists", !!configRes.result?.contents?.[0]?.text, true);
  check("read config mimeType", configRes.result?.contents?.[0]?.mimeType, "application/json");

  // Other resources should error (no project initialized)
  for (const uri of ["gsd://state", "gsd://project", "gsd://roadmap", "gsd://requirements"]) {
    const errRes = await server.send("resources/read", { uri });
    const isError = !!errRes.error || !!errRes.result?.isError;
    check(`read ${uri} errors (no project)`, isError, true);
  }

  console.log("\n=== TOOLS/LIST ===\n");
  const toolList = await server.send("tools/list");
  const tools = toolList.result?.tools || [];
  const toolNames = tools.map(t => t.name).sort();
  check("tools/list count", tools.length, 34);

  const expectedTools = [
    "gsd_add_phase", "gsd_add_todo", "gsd_audit_uat", "gsd_check_todos",
    "gsd_commit", "gsd_complete_milestone", "gsd_config_get", "gsd_config_set",
    "gsd_debug", "gsd_discuss_phase", "gsd_execute_phase", "gsd_insert_phase",
    "gsd_list_phases", "gsd_map_codebase", "gsd_new_milestone", "gsd_new_project",
    "gsd_phase_complete", "gsd_plan_phase", "gsd_progress", "gsd_quick",
    "gsd_roadmap_analyze", "gsd_run", "gsd_scaffold", "gsd_set_profile",
    "gsd_settings", "gsd_ship", "gsd_sketch", "gsd_spike",
    "gsd_state", "gsd_todo_complete", "gsd_validate", "gsd_verify_work",
    "gsd_websearch", "gsd_workstreams",
  ].sort();

  for (let i = 0; i < expectedTools.length; i++) {
    check(`tool[${i}] name`, toolNames[i], expectedTools[i]);
  }

  console.log("\n=== TOOLS/CALL ===\n");

  // 1. gsd_state
  const stateRes = await server.send("tools/call", { name: "gsd_state", arguments: {} });
  check("gsd_state has content", !!stateRes.result?.content?.[0]?.text, true);
  check("gsd_state isError (no project)", !!stateRes.result?.isError, true);

  // 2. gsd_progress
  const progRes = await server.send("tools/call", { name: "gsd_progress", arguments: {} });
  check("gsd_progress has content", !!progRes.result?.content?.[0]?.text, true);

  // 3. gsd_new_project
  const newProj = await server.send("tools/call", { name: "gsd_new_project", arguments: { name: "TestProject", description: "test" } });
  check("gsd_new_project message", newProj.result?.content?.[0]?.text?.includes("TestProject"), true);

  // 4. gsd_new_milestone
  const newMil = await server.send("tools/call", { name: "gsd_new_milestone", arguments: { name: "v2.0" } });
  check("gsd_new_milestone proxy", newMil.result?.content?.[0]?.text?.includes("gsd-new-milestone"), true);

  // 5. gsd_map_codebase
  const mapCb = await server.send("tools/call", { name: "gsd_map_codebase", arguments: {} });
  check("gsd_map_codebase proxy", mapCb.result?.content?.[0]?.text?.includes("gsd-map-codebase"), true);

  // 6. gsd_discuss_phase
  const discPh = await server.send("tools/call", { name: "gsd_discuss_phase", arguments: { phase: 1 } });
  check("gsd_discuss_phase proxy", discPh.result?.content?.[0]?.text?.includes("gsd-discuss-phase 1"), true);

  // 7. gsd_list_phases
  const listPh = await server.send("tools/call", { name: "gsd_list_phases", arguments: {} });
  check("gsd_list_phases no roadmap", listPh.result?.content?.[0]?.text, "No roadmap found");

  // 8-10. gsd_plan_phase, gsd_execute_phase, gsd_verify_work
  for (const name of ["gsd_plan_phase", "gsd_execute_phase", "gsd_verify_work"]) {
    const res = await server.send("tools/call", { name, arguments: { phase: 1 } });
    const cmd = name.replace("gsd_", "").replace(/_/g, "-");
    check(`${name} proxy`, res.result?.content?.[0]?.text?.includes(cmd), true);
  }

  // 11. gsd_quick
  const quick = await server.send("tools/call", { name: "gsd_quick", arguments: { task: "fix bug", full: true } });
  check("gsd_quick proxy", quick.result?.content?.[0]?.text?.includes('"fix bug"'), true);
  check("gsd_quick --full", quick.result?.content?.[0]?.text?.includes("--full"), true);

  // 12. gsd_debug
  const debug = await server.send("tools/call", { name: "gsd_debug", arguments: { issue: "crash on startup" } });
  check("gsd_debug proxy", debug.result?.content?.[0]?.text?.includes('"crash on startup"'), true);

  // 13. gsd_spike
  const spike = await server.send("tools/call", { name: "gsd_spike", arguments: { idea: "try new lib", quick: true } });
  check("gsd_spike proxy", spike.result?.content?.[0]?.text?.includes('"try new lib"'), true);
  check("gsd_spike --quick", spike.result?.content?.[0]?.text?.includes("--quick"), true);

  // 14. gsd_sketch
  const sketch = await server.send("tools/call", { name: "gsd_sketch", arguments: { idea: "new dashboard" } });
  check("gsd_sketch proxy", sketch.result?.content?.[0]?.text?.includes('"new dashboard"'), true);

  // 15. gsd_complete_milestone
  const compMil = await server.send("tools/call", { name: "gsd_complete_milestone", arguments: { version: "1.0.0" } });
  check("gsd_complete_milestone proxy", compMil.result?.content?.[0]?.text?.includes("gsd-complete-milestone 1.0.0"), true);

  // 16. gsd_add_todo
  const addTodo = await server.send("tools/call", { name: "gsd_add_todo", arguments: { description: "review PR" } });
  check("gsd_add_todo message", addTodo.result?.content?.[0]?.text?.includes("Todo captured"), true);

  // 17. gsd_check_todos
  const chkTodo = await server.send("tools/call", { name: "gsd_check_todos", arguments: { area: "" } });
  check("gsd_check_todos has content", !!chkTodo.result?.content?.[0]?.text, true);

  // 18. gsd_ship
  const ship = await server.send("tools/call", { name: "gsd_ship", arguments: { phase: 1 } });
  check("gsd_ship proxy", ship.result?.content?.[0]?.text?.includes("gsd-ship 1"), true);

  // 19. gsd_add_phase
  const addPh = await server.send("tools/call", { name: "gsd_add_phase", arguments: { description: "testing phase" } });
  check("gsd_add_phase proxy", addPh.result?.content?.[0]?.text?.includes('"testing phase"'), true);

  // 20. gsd_insert_phase
  const insPh = await server.send("tools/call", { name: "gsd_insert_phase", arguments: { after: 3, description: "urgent fix" } });
  check("gsd_insert_phase proxy", insPh.result?.content?.[0]?.text?.includes('3 "urgent fix"'), true);

  // 21. gsd_settings
  const settings = await server.send("tools/call", { name: "gsd_settings", arguments: {} });
  check("gsd_settings proxy", settings.result?.content?.[0]?.text?.includes("gsd-settings"), true);

  // 22. gsd_set_profile
  const setProf = await server.send("tools/call", { name: "gsd_set_profile", arguments: { profile: "quality" } });
  check("gsd_set_profile proxy", setProf.result?.content?.[0]?.text?.includes("gsd-set-profile quality"), true);

  // 23. gsd_run (tries "state get" but GSD tools expect separate args; "state" is prefix, "get" is action)
  const run = await server.send("tools/call", { name: "gsd_run", arguments: { command: "state get" } });
  check("gsd_run has content", !!run.result?.content?.[0]?.text, true);

  // 24. gsd_validate
  const valid = await server.send("tools/call", { name: "gsd_validate", arguments: { check: "health" } });
  check("gsd_validate has content", !!valid.result?.content?.[0]?.text, true);

  // 25. gsd_roadmap_analyze
  const road = await server.send("tools/call", { name: "gsd_roadmap_analyze", arguments: {} });
  check("gsd_roadmap_analyze has content", !!road.result?.content?.[0]?.text, true);

  // 26. gsd_phase_complete
  const phComp = await server.send("tools/call", { name: "gsd_phase_complete", arguments: { phase: 1 } });
  check("gsd_phase_complete has content", !!phComp.result?.content?.[0]?.text, true);

  // 27. gsd_config_get
  const cfgGet = await server.send("tools/call", { name: "gsd_config_get", arguments: { key: "workflow.profiles" } });
  check("gsd_config_get has content", !!cfgGet.result?.content?.[0]?.text, true);

  // 28. gsd_config_set
  const cfgSet = await server.send("tools/call", { name: "gsd_config_set", arguments: { key: "workflow.test_key", value: '"test"' } });
  check("gsd_config_set has content", !!cfgSet.result?.content?.[0]?.text, true);

  // 29. gsd_commit
  const commit = await server.send("tools/call", { name: "gsd_commit", arguments: { message: "test commit" } });
  check("gsd_commit has content", !!commit.result?.content?.[0]?.text, true);

  // 30. gsd_scaffold
  const scaf = await server.send("tools/call", { name: "gsd_scaffold", arguments: { type: "context", phase: 1 } });
  check("gsd_scaffold has content", !!scaf.result?.content?.[0]?.text, true);

  // 31. gsd_audit_uat
  const audit = await server.send("tools/call", { name: "gsd_audit_uat", arguments: {} });
  check("gsd_audit_uat has content", !!audit.result?.content?.[0]?.text, true);

  // 32. gsd_websearch
  const web = await server.send("tools/call", { name: "gsd_websearch", arguments: { query: "test search" } });
  check("gsd_websearch has content", !!web.result?.content?.[0]?.text, true);

  // 33. gsd_todo_complete
  const todoDone = await server.send("tools/call", { name: "gsd_todo_complete", arguments: { filename: "test-todo.md" } });
  check("gsd_todo_complete has content", !!todoDone.result?.content?.[0]?.text, true);

  // 34. gsd_workstreams
  const wsList = await server.send("tools/call", { name: "gsd_workstreams", arguments: { action: "list" } });
  check("gsd_workstreams has content", !!wsList.result?.content?.[0]?.text, true);

  console.log("\n=== INPUT VALIDATION ===\n");

  // Test Zod validation rejects missing required params
  const noName = await server.send("tools/call", { name: "gsd_new_project", arguments: {} });
  check("gsd_new_project rejects missing name", !!noName.error || !!noName.result?.isError, true);

  const badPhase = await server.send("tools/call", { name: "gsd_discuss_phase", arguments: { phase: "abc" } });
  check("gsd_discuss_phase rejects string phase", !!badPhase.error || !!badPhase.result?.isError, true);

  const badProfile = await server.send("tools/call", { name: "gsd_set_profile", arguments: { profile: "invalid" } });
  check("gsd_set_profile rejects invalid enum", !!badProfile.error || !!badProfile.result?.isError, true);

  // Unknown tool
  const unknown = await server.send("tools/call", { name: "gsd_unknown", arguments: {} });
  check("unknown tool returns error", !!unknown.error || !!unknown.result?.isError, true);

  server.close();

  // Clean up .planning/ created by side-effecting tool calls
  if (existsSync(stale)) rmSync(stale, { recursive: true, force: true });

  console.log(`\n========================================`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(1);
});
