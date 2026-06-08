#!/usr/bin/env node
import { spawn } from "child_process";

let msgId = 0;
const pending = new Map();

async function main() {
  const proc = spawn("node", ["./index.js"], {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: import.meta.dirname,
  });

  const send = (method, params = {}) => {
    const id = ++msgId;
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve) => pending.set(id, resolve));
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
        if (resolve) { pending.delete(msg.id); resolve(msg); }
      } catch { /* partial */ }
    }
  });

  await new Promise((r) => setTimeout(r, 300));

  // Init
  await send("initialize", {
    protocolVersion: "2024-11-05", capabilities: {},
    clientInfo: { name: "edge-test", version: "1.0.0" },
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  let passed = 0, failed = 0;

  function check(name, ok, detail = "") {
    if (ok) { passed++; console.log(`  PASS | ${name}`); }
    else { failed++; console.log(`  FAIL | ${name} ${detail}`); }
  }

  function isError(res) {
    return !!(res.error || res.result?.isError);
  }

  console.log("\n=== EDGE CASE: EMPTY / BOUNDARY PARAMS ===\n");

  // Empty name
  let r = await send("tools/call", { name: "gsd_new_project", arguments: { name: "" } });
  check("gsd_new_project rejects empty name", isError(r));

  // Empty task
  r = await send("tools/call", { name: "gsd_quick", arguments: { task: "" } });
  check("gsd_quick rejects empty task", isError(r));

  // Phase = 0 (positive required)
  r = await send("tools/call", { name: "gsd_discuss_phase", arguments: { phase: 0 } });
  check("gsd_discuss_phase rejects phase=0 (not positive)", isError(r));

  // Phase = -1
  r = await send("tools/call", { name: "gsd_discuss_phase", arguments: { phase: -1 } });
  check("gsd_discuss_phase rejects phase=-1 (negative)", isError(r));

  // Phase = 1.5 (not integer)
  r = await send("tools/call", { name: "gsd_discuss_phase", arguments: { phase: 1.5 } });
  check("gsd_discuss_phase rejects phase=1.5 (not int)", isError(r));

  // Extra params (should be ignored but not crash)
  r = await send("tools/call", { name: "gsd_settings", arguments: { extraParam: "should be ignored" } });
  check("gsd_settings with extra params", !isError(r));

  // Boolean instead of string
  r = await send("tools/call", { name: "gsd_new_project", arguments: { name: true } });
  check("gsd_new_project rejects boolean name", isError(r));

  // Null phase
  r = await send("tools/call", { name: "gsd_discuss_phase", arguments: { phase: null } });
  check("gsd_discuss_phase rejects null phase", isError(r));

  // Very long string (should be accepted, Zod min(1) is the only constraint)
  const longStr = "a".repeat(10000);
  r = await send("tools/call", { name: "gsd_new_project", arguments: { name: longStr } });
  check("gsd_new_project accepts 10k char name", !isError(r));

  // Empty object args (no project = isError, but should not crash)
  r = await send("tools/call", { name: "gsd_state", arguments: {} });
  check("gsd_state with empty args no crash", r.result?.content?.[0]?.text?.length > 0);

  console.log("\n=== EDGE CASE: GSD COMMAND ===\n");

  // gsd_run with empty command (should be rejected)
  r = await send("tools/call", { name: "gsd_run", arguments: { command: "" } });
  check("gsd_run rejects empty command", isError(r));

  // gsd_run with multi-word command (no project = isError, but command was split correctly)
  r = await send("tools/call", { name: "gsd_run", arguments: { command: "state get" } });
  check("gsd_run multi-word no crash", r.result?.content?.[0]?.text?.length > 0);

  // gsd_run with unknown command (should error gracefully, not crash server)
  r = await send("tools/call", { name: "gsd_run", arguments: { command: "nonexistent_command" } });
  check("gsd_run unknown command errors gracefully", isError(r));

  // gsd_add_todo with empty description
  r = await send("tools/call", { name: "gsd_add_todo", arguments: { description: "" } });
  check("gsd_add_todo rejects empty description", isError(r));

  // gsd_set_profile invalid profile name (additional edge)
  r = await send("tools/call", { name: "gsd_set_profile", arguments: { profile: "ultra" } });
  check("gsd_set_profile rejects 'ultra'", isError(r));

  // gsd_set_profile valid profile
  r = await send("tools/call", { name: "gsd_set_profile", arguments: { profile: "inherit" } });
  check("gsd_set_profile 'inherit' OK", !isError(r));

  console.log("\n=== EDGE CASE: RESOURCES ===\n");

  // Read unknown URI
  r = await send("resources/read", { uri: "gsd://nonexistent" });
  check("unknown resource URI errors", isError(r));

  // Read with extra params (should be ignored or error gracefully)
  r = await send("resources/read", { uri: "gsd://help", extra: "field" });
  check("resource read with extra params", !isError(r));

  console.log("\n=== EDGE CASE: CONCURRENT CALLS ===\n");

  // Fire 5 calls at once, verify all resolve
  const concurrent = await Promise.all([
    send("tools/call", { name: "gsd_state", arguments: {} }),
    send("tools/call", { name: "gsd_progress", arguments: {} }),
    send("tools/call", { name: "gsd_list_phases", arguments: {} }),
    send("tools/call", { name: "gsd_settings", arguments: {} }),
    send("tools/call", { name: "gsd_ship", arguments: { phase: 1 } }),
  ]);
  check("5 concurrent calls all resolved", concurrent.length === 5);
  check("concurrent state no crash", concurrent[0].result?.content?.[0]?.text?.length > 0);
  check("concurrent progress no crash", concurrent[1].result?.content?.[0]?.text?.length > 0);
  check("concurrent list_phases OK", !isError(concurrent[2]));
  check("concurrent settings OK", !isError(concurrent[3]));
  check("concurrent ship OK", !isError(concurrent[4]));

  proc.stdin.end();
  proc.kill();

  console.log(`\n========================================`);
  console.log(`  Edge Case Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Edge test error:", e);
  process.exit(1);
});
