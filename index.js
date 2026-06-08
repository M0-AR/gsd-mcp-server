#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const GSD_BIN = join(homedir(), ".config/opencode/get-shit-done/bin/gsd-tools.cjs");
const PLANNING_DIR = ".planning";

function gsd(...args) {
  const out = execFileSync("node", [GSD_BIN, ...args, "--raw"], {
    encoding: "utf-8",
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  }).trim();
  try { return JSON.parse(out); } catch { return { output: out }; }
}

function findPlanningRoot() {
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(join(dir, PLANNING_DIR))) return dir;
    dir = join(dir, "..");
  }
  return process.cwd();
}

function readPlanningFile(name) {
  const root = findPlanningRoot();
  const path = join(root, PLANNING_DIR, name);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

const server = new McpServer({
  name: "gsd-mcp-server",
  version: "2.0.0"
});

// ── Resources ──────────────────────────────────────

server.resource("state", "gsd://state", { mimeType: "text/markdown", description: "Current GSD project state" }, async () => {
  const content = readPlanningFile("STATE.md");
  if (!content) throw new Error("No STATE.md found — run /gsd-new-project first");
  return { contents: [{ uri: "gsd://state", mimeType: "text/markdown", text: content }] };
});

server.resource("project", "gsd://project", { mimeType: "text/markdown", description: "Project definition and vision" }, async () => {
  const content = readPlanningFile("PROJECT.md");
  if (!content) throw new Error("No PROJECT.md found — run /gsd-new-project first");
  return { contents: [{ uri: "gsd://project", mimeType: "text/markdown", text: content }] };
});

server.resource("roadmap", "gsd://roadmap", { mimeType: "text/markdown", description: "Phase roadmap with success criteria" }, async () => {
  const content = readPlanningFile("ROADMAP.md");
  if (!content) throw new Error("No ROADMAP.md found — run /gsd-new-project first");
  return { contents: [{ uri: "gsd://roadmap", mimeType: "text/markdown", text: content }] };
});

server.resource("requirements", "gsd://requirements", { mimeType: "text/markdown", description: "Feature requirements traceable by ID" }, async () => {
  const content = readPlanningFile("REQUIREMENTS.md");
  if (!content) throw new Error("No REQUIREMENTS.md found — run /gsd-new-project first");
  return { contents: [{ uri: "gsd://requirements", mimeType: "text/markdown", text: content }] };
});

server.resource("config", "gsd://config", { mimeType: "application/json", description: "Project planning configuration" }, async () => {
  const content = readPlanningFile("config.json");
  if (!content) return { contents: [{ uri: "gsd://config", mimeType: "application/json", text: "{}" }] };
  return { contents: [{ uri: "gsd://config", mimeType: "application/json", text: content }] };
});

server.resource("help", "gsd://help", { mimeType: "text/markdown", description: "Full GSD command reference" }, async () => {
  const helpPath = join(homedir(), ".config/opencode/commands/gsd/gsd-help.md");
  let text = "GSD Help not available — see https://opencode.ai for documentation.";
  if (existsSync(helpPath)) {
    text = readFileSync(helpPath, "utf-8");
  }
  return { contents: [{ uri: "gsd://help", mimeType: "text/markdown", text }] };
});

// ── Tools ──────────────────────────────────────────

server.tool("gsd_state", "Get current GSD project state (phase, milestone, next steps)", {}, async () => {
  try {
    const state = gsd("state", "get");
    const project = readPlanningFile("PROJECT.md");
    return {
      content: [{ type: "text", text: JSON.stringify({ state: state.output || state, project: project?.slice(0, 2000) || "No project initialized" }, null, 2) }]
    };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `GSD error: ${e.stderr?.trim() || e.message}` }] };
  }
});

server.tool("gsd_progress", "Show what step to run next in the GSD lifecycle", {}, async () => {
  try {
    const s = gsd("state", "get");
    const r = readPlanningFile("ROADMAP.md");
    return {
      content: [{ type: "text", text: `## Current State\n${s.output || JSON.stringify(s)}\n\n## Roadmap\n${r?.slice(0, 2500) || "No roadmap yet — run /gsd-new-project"}` }]
    };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `GSD error: ${e.stderr?.trim() || e.message}` }] };
  }
});

server.tool("gsd_new_project", "Initialize a new GSD project (run once per project)", {
  name: z.string().min(1).describe("Project name"),
  description: z.string().optional().describe("Optional project description")
}, async ({ name, description }) => {
  try {
    gsd("state", "update", "project_name", name);
    if (description) gsd("state", "update", "description", description);
    return { content: [{ type: "text", text: `Project "${name}" initialized. Run /gsd-new-project in OpenCode to complete the full setup flow.` }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `GSD error: ${e.stderr?.trim() || e.message}` }] };
  }
});

server.tool("gsd_new_milestone", "Start a new milestone", {
  name: z.string().min(1).describe("Milestone name (e.g. v2.0)")
}, async ({ name }) => {
  return { content: [{ type: "text", text: `Run /gsd-new-milestone "${name}" in OpenCode.` }] };
});

server.tool("gsd_map_codebase", "Analyze existing codebase with parallel explore agents", {}, async () => {
  return { content: [{ type: "text", text: "Run /gsd-map-codebase in OpenCode to spawn parallel explore agents." }] };
});

server.tool("gsd_discuss_phase", "Capture implementation decisions before planning a phase", {
  phase: z.number().int().positive().describe("Phase number (e.g. 1)")
}, async ({ phase }) => {
  return { content: [{ type: "text", text: `Run /gsd-discuss-phase ${phase} in OpenCode.` }] };
});

server.tool("gsd_list_phases", "List all phases from the roadmap", {}, async () => {
  const r = readPlanningFile("ROADMAP.md");
  return { content: [{ type: "text", text: r || "No roadmap found" }] };
});

server.tool("gsd_plan_phase", "Research and create task plans for a phase", {
  phase: z.number().int().positive().describe("Phase number (e.g. 1)")
}, async ({ phase }) => {
  return { content: [{ type: "text", text: `Run /gsd-plan-phase ${phase} in OpenCode.` }] };
});

server.tool("gsd_execute_phase", "Execute all plans for a phase in parallel waves", {
  phase: z.number().int().positive().describe("Phase number (e.g. 1)")
}, async ({ phase }) => {
  return { content: [{ type: "text", text: `Run /gsd-execute-phase ${phase} in OpenCode.` }] };
});

server.tool("gsd_verify_work", "Verify phase work against goals via conversational UAT", {
  phase: z.number().int().positive().describe("Phase number (e.g. 1)")
}, async ({ phase }) => {
  return { content: [{ type: "text", text: `Run /gsd-verify-work ${phase} in OpenCode.` }] };
});

server.tool("gsd_quick", "Execute ad-hoc task with GSD guarantees", {
  task: z.string().min(1).describe("Task description"),
  full: z.boolean().optional().describe("Full quality pipeline")
}, async ({ task, full }) => {
  return { content: [{ type: "text", text: `Run /gsd-quick "${task}"${full ? " --full" : ""} in OpenCode.` }] };
});

server.tool("gsd_debug", "Systematic debugging with persistent state across context resets", {
  issue: z.string().min(1).describe("Issue description")
}, async ({ issue }) => {
  return { content: [{ type: "text", text: `Run /gsd-debug "${issue}" in OpenCode.` }] };
});

server.tool("gsd_spike", "Rapidly spike an idea with throwaway experiments", {
  idea: z.string().min(1).describe("Idea to validate"),
  quick: z.boolean().optional().describe("Skip evaluation phase")
}, async ({ idea, quick }) => {
  return { content: [{ type: "text", text: `Run /gsd-spike "${idea}"${quick ? " --quick" : ""} in OpenCode.` }] };
});

server.tool("gsd_sketch", "Rapidly sketch UI/design ideas with HTML mockups", {
  idea: z.string().min(1).describe("UI idea to sketch")
}, async ({ idea }) => {
  return { content: [{ type: "text", text: `Run /gsd-sketch "${idea}" in OpenCode.` }] };
});

server.tool("gsd_complete_milestone", "Archive completed milestone and prepare for next version", {
  version: z.string().min(1).describe("Version tag (e.g. 1.0.0)")
}, async ({ version }) => {
  return { content: [{ type: "text", text: `Run /gsd-complete-milestone ${version} in OpenCode.` }] };
});

server.tool("gsd_add_todo", "Capture idea or task as todo from current conversation", {
  description: z.string().min(1).describe("Todo description")
}, async ({ description }) => {
  try {
    gsd("state", "update", "todo", description);
    return { content: [{ type: "text", text: `Todo captured. Run /gsd-add-todo "${description}" in OpenCode to formalize it.` }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `GSD error: ${e.stderr?.trim() || e.message}` }] };
  }
});

server.tool("gsd_check_todos", "List pending todos", {
  area: z.string().optional().describe("Optional area filter")
}, async ({ area }) => {
  try {
    const t = gsd("list-todos", area || "");
    return { content: [{ type: "text", text: JSON.stringify(t, null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `GSD error: ${e.stderr?.trim() || e.message}` }] };
  }
});

server.tool("gsd_ship", "Create a PR from completed phase work", {
  phase: z.number().int().positive().describe("Phase number to ship")
}, async ({ phase }) => {
  return { content: [{ type: "text", text: `Run /gsd-ship ${phase} in OpenCode.` }] };
});

server.tool("gsd_add_phase", "Add new phase to end of current milestone", {
  description: z.string().min(1).describe("Phase description")
}, async ({ description }) => {
  return { content: [{ type: "text", text: `Run /gsd-add-phase "${description}" in OpenCode.` }] };
});

server.tool("gsd_insert_phase", "Insert urgent work as decimal phase between existing phases", {
  after: z.number().describe("Phase number to insert after (e.g. 3)"),
  description: z.string().min(1).describe("Phase description")
}, async ({ after, description }) => {
  return { content: [{ type: "text", text: `Run /gsd-insert-phase ${after} "${description}" in OpenCode.` }] };
});

server.tool("gsd_settings", "Configure workflow toggles and model profile", {}, async () => {
  return { content: [{ type: "text", text: "Run /gsd-settings in OpenCode to configure workflow toggles and model profile." }] };
});

server.tool("gsd_set_profile", "Switch model profile", {
  profile: z.enum(["quality", "balanced", "budget", "inherit"]).describe("Model profile")
}, async ({ profile }) => {
  return { content: [{ type: "text", text: `Run /gsd-set-profile ${profile} in OpenCode.` }] };
});

server.tool("gsd_run", "Run any GSD command directly (see gsd://help for full list)", {
  command: z.string().min(1).describe("GSD command without /gsd- prefix")
}, async ({ command }) => {
  try {
    const out = gsd(...command.trim().split(/\s+/));
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `GSD error: ${e.stderr?.trim() || e.message}` }] };
  }
});

// ── Transport ──────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
