import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAutoNotify,
  isPendingToolResult,
  isSubagentSession,
  questionText,
  toSnippet,
} from "../lib/auto-notify.js";

/** Harness with a controllable clock and a manual timer queue. */
function harness(options = {}) {
  const notes = [];
  const timers = new Map();
  let timerId = 0;
  let clock = 1_000_000;

  const auto = createAutoNotify({
    minSeconds: 10,
    snippetChars: 60,
    approvalDelayMs: 1500,
    questionDelayMs: 2000,
    ...options,
    onNotify: (note) => notes.push(note),
    now: () => clock,
    schedule: (fn, ms) => {
      const id = ++timerId;
      timers.set(id, { fn, due: clock + ms });
      return id;
    },
    cancel: (id) => timers.delete(id),
  });

  return {
    auto,
    notes,
    advance(ms) {
      clock += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= clock) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pendingTimers: () => timers.size,
  };
}

const session = (id = "s1", header = {}) => ({ id, header });
const turnStart = (turn = 1) => ({ type: "turn/start", data: { turn } });

const assistant = (text) => ({
  type: "assistant/message",
  data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text }] } },
});

const askCall = (callId, question) => ({
  type: "tool/call",
  data: {
    turn: 1,
    step: 1,
    callId,
    name: "ask_user_question",
    arguments: JSON.stringify({ questions: [{ question }] }),
  },
});

const toolResult = (callId, content = [{ type: "text", text: "answered" }]) => ({
  type: "tool/result",
  data: { turn: 1, step: 1, message: { role: "tool", toolCallId: callId, content } },
});

const pendingResult = (callId) => toolResult(callId, [{ type: "text", text: '{"pending":true,"callId":"c1"}' }]);

const notifyCall = (callId = "n1") => ({
  type: "tool/call",
  data: { turn: 1, step: 1, callId, name: "win_notify", arguments: "{}" },
});

const approvalAsked = (id, toolName = "bash", reason = "") => ({
  type: "approval/asked",
  data: { id, toolName, reason },
});
const approvalDecided = (id) => ({ type: "approval/decided", data: { id, outcome: "approved" } });

test("a turn above the threshold notifies with the reply snippet", () => {
  const h = harness();
  const s = session();
  h.auto.observe(s, turnStart());
  h.advance(25_000);
  h.auto.observe(s, assistant("已完成重构，测试全部通过。"));

  assert.deepEqual(h.auto.finish(s), {
    kind: "done",
    title: "DSH 任务完成",
    body: "已完成重构，测试全部通过。",
  });
});

test("short turns stay silent", () => {
  const h = harness();
  const s = session();
  h.auto.observe(s, turnStart());
  h.advance(3_000);
  h.auto.observe(s, assistant("好的"));
  assert.equal(h.auto.finish(s), null);
});

test("a waiting question is announced after the grace period", () => {
  const h = harness();
  const s = session();
  h.auto.observe(s, turnStart());
  h.auto.observe(s, askCall("c1", "要覆盖旧配置吗？"));

  assert.equal(h.notes.length, 0, "no toast during the grace period");
  h.advance(2_000);

  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].kind, "question");
  assert.match(h.notes[0].body, /要覆盖旧配置吗？/);
});

test("an answer inside the grace period keeps quiet", () => {
  const h = harness();
  const s = session();
  h.auto.observe(s, turnStart());
  h.auto.observe(s, askCall("c1", "要覆盖旧配置吗？"));
  h.advance(300);
  h.auto.observe(s, toolResult("c1"));
  h.advance(5_000);

  assert.equal(h.notes.length, 0);
  assert.equal(h.auto.finish(s), null);
});

test("a timed-out (pending) question is announced at turn end", () => {
  const h = harness();
  const s = session();
  h.auto.observe(s, turnStart());
  h.advance(30_000);
  h.auto.observe(s, askCall("c1", "还在吗？"));
  h.auto.observe(s, pendingResult("c1"));
  h.advance(5_000);

  const note = h.auto.finish(s);
  assert.equal(note?.kind, "question");
  assert.match(note?.body ?? "", /还在吗？/);
});

test("a question that was already announced is not repeated at idle", () => {
  const h = harness();
  const s = session();
  h.auto.observe(s, turnStart());
  h.auto.observe(s, askCall("c1", "要覆盖旧配置吗？"));
  h.advance(2_000);
  h.auto.observe(s, pendingResult("c1"));

  assert.equal(h.notes.length, 1);
  assert.equal(h.auto.finish(s), null);
});

test("calling win_notify yourself suppresses the automatic completion toast", () => {
  const h = harness();
  const s = session();
  h.auto.observe(s, turnStart());
  h.advance(30_000);
  h.auto.observe(s, assistant("完成"));
  h.auto.observe(s, notifyCall());
  assert.equal(h.auto.finish(s), null);
});

test("subagent sessions never produce completion toasts", () => {
  const h = harness();
  const s = session("sub", { origin: "subagent", depth: 1 });
  h.auto.observe(s, turnStart());
  h.advance(30_000);
  h.auto.observe(s, assistant("子代理完成"));
  assert.equal(h.auto.finish(s), null);
});

test("subagent questions still reach the human", () => {
  const h = harness();
  const s = session("sub", { origin: "subagent", depth: 1 });
  h.auto.observe(s, turnStart());
  h.auto.observe(s, askCall("c9", "子代理需要确认"));
  h.advance(2_000);

  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].kind, "question");
});

test("an undecided approval notifies after the grace period", () => {
  const h = harness();
  const s = session();
  h.auto.observe(s, turnStart());
  h.auto.observe(s, approvalAsked("a1", "bash", "rm -rf build"));

  assert.equal(h.notes.length, 0);
  h.advance(1_500);

  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].kind, "approval");
  assert.match(h.notes[0].body, /bash/);
  assert.match(h.notes[0].body, /rm -rf build/);
});

test("a quickly decided approval stays silent", () => {
  const h = harness();
  const s = session();
  h.auto.observe(s, turnStart());
  h.auto.observe(s, approvalAsked("a1"));
  h.advance(200);
  h.auto.observe(s, approvalDecided("a1"));
  h.advance(5_000);

  assert.equal(h.notes.length, 0);
  assert.equal(h.pendingTimers(), 0);
});

test("parallel approvals coalesce into one toast", () => {
  const h = harness();
  const s = session();
  h.auto.observe(s, turnStart());
  h.auto.observe(s, approvalAsked("a1", "bash"));
  h.auto.observe(s, approvalAsked("a2", "write"));
  h.advance(1_500);

  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0].body, /2 个请求/);
});

test("after an approval toast the completion toast is suppressed", () => {
  const h = harness();
  const s = session();
  h.auto.observe(s, turnStart());
  h.advance(20_000);
  h.auto.observe(s, approvalAsked("a1", "bash"));
  h.advance(2_000);
  h.auto.observe(s, approvalDecided("a1"));
  h.auto.observe(s, assistant("授权后已跑完"));
  h.advance(20_000);

  assert.equal(h.notes.length, 1);
  assert.equal(h.auto.finish(s), null);
});

test("snippets are flattened and bounded", () => {
  assert.equal(toSnippet("a".repeat(200), 20).length, 20);
  assert.equal(toSnippet("```js\nconst x = 1\n```\n**done**"), "done");
});

test("questionText tolerates malformed arguments", () => {
  assert.equal(questionText("not json"), "");
  assert.equal(questionText(JSON.stringify({ questions: [] })), "");
  assert.equal(
    questionText(JSON.stringify({ questions: [{ question: "Q1" }, { question: "Q2" }] })),
    "Q1（共 2 个问题）",
  );
});

test("pending tool results are recognised", () => {
  assert.equal(isPendingToolResult({ content: [{ type: "text", text: '{"pending":true}' }] }), true);
  assert.equal(isPendingToolResult({ content: [{ type: "text", text: '{"pending":false}' }] }), false);
  assert.equal(isPendingToolResult({ content: [{ type: "text", text: "plain" }] }), false);
});

test("subagent detection covers origin and lineage depth", () => {
  assert.equal(isSubagentSession(session("a", {})), false);
  assert.equal(isSubagentSession(session("b", { origin: "subagent" })), true);
  assert.equal(isSubagentSession(session("c", { depth: 2 })), true);
});
