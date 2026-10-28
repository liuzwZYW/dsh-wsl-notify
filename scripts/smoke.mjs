/**
 * Smoke test: mount the plugin on a fake Cordis context, drive one turn to
 * completion, and let the real notifier fire once (a Windows toast).
 *
 * Run with `npm run smoke` inside WSL.
 */
import assert from "node:assert/strict";
import { apply } from "../index.js";

const handlers = new Map();
const registered = [];
const sections = [];

const ctx = {
  tools: { register: (tool) => registered.push(tool) },
  systemPrompt: { section: (section) => sections.push(section) },
  on: (event, handler) => handlers.set(event, handler),
  logger: { info() {}, warn: (...args) => console.error("[warn]", ...args) },
};

apply(ctx, { autoMinSeconds: 0.01, autoMode: "toast", approvalDelayMs: 50, questionDelayMs: 50 });

assert.equal(registered.length, 1, "win_notify tool registered");
assert.equal(registered[0].name, "win_notify");
assert.equal(sections.length, 1, "prompt section registered");
assert.ok(handlers.has("session/event"), "session/event hooked");
assert.ok(handlers.has("agent/status"), "agent/status hooked");
assert.ok(handlers.has("agent/disposed"), "agent/disposed hooked");

const session = { id: "smoke-session", header: { depth: 0 } };
const emit = (event) => handlers.get("session/event")(session, event);

emit({ type: "turn/start", data: { turn: 1 } });
await new Promise((resolve) => setTimeout(resolve, 200));
emit({
  type: "assistant/message",
  data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: "smoke: 插件自动通知链路可用" }] } },
});

const note = handlers.get("agent/status")({ agent: { session }, status: "idle" });
assert.equal(note, undefined, "idle handler returns nothing");

// Give the fire-and-forget PowerShell call time to finish.
await new Promise((resolve) => setTimeout(resolve, 6000));
console.log("smoke ok: handlers wired, one toast requested (see Windows desktop)");

process.exit(0);
