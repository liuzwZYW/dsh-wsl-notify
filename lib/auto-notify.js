/**
 * Deterministic, model-independent notifications.
 *
 * The `win_notify` tool only fires when the model remembers to call it, which
 * in practice means most finished tasks went unannounced (0.1.x behaviour).
 * This module watches the durable session event stream instead and decides on
 * its own when a human should be told that something finished or that the agent
 * is blocked waiting for them:
 *
 *   - a top-level turn went idle after real work        → "任务完成"
 *   - `ask_user_question` waits for a human answer      → "等待你的选择"
 *   - a tool call needs approval (`approval/asked`)     → "需要授权"
 *
 * Subagent sessions never produce completion notifications (a fan-out would
 * spam the desktop), but their questions and approval requests do notify,
 * because those are surfaced in the parent conversation and still block work.
 */

/** Tool whose pending call means "the human owes the agent an answer". */
export const ASK_TOOL = "ask_user_question";
/** Tool that sends a notification itself; auto-notify stays quiet afterwards. */
export const NOTIFY_TOOL = "win_notify";

/**
 * Whether a session is a subagent child.
 * `origin` is presentation metadata; `depth` is the authoritative lineage hint.
 */
export function isSubagentSession(session) {
  const header = session?.header;
  if (!header) return false;
  if (header.origin === "subagent") return true;
  return typeof header.depth === "number" && header.depth > 0;
}

/** Collapse whitespace, drop the noisiest markdown, and bound the length. */
export function toSnippet(text, maxChars = 140) {
  const flat = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** Extract the human-facing text of an `ask_user_question` call. */
export function questionText(rawArgs) {
  let parsed;
  try {
    parsed = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
  } catch {
    return "";
  }
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  if (questions.length === 0) return "";
  const first = questions[0] ?? {};
  const question = typeof first.question === "string" && first.question.trim()
    ? first.question.trim()
    : typeof first.header === "string" ? first.header.trim() : "";
  if (!question) return "";
  return questions.length > 1 ? `${question}（共 ${questions.length} 个问题）` : question;
}

/** A timed-out question records `{"pending":true,...}` as its tool result. */
export function isPendingToolResult(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  const text = content.find((block) => block?.type === "text");
  if (!text || typeof text.text !== "string") return false;
  try {
    const parsed = JSON.parse(text.text);
    return typeof parsed === "object" && parsed !== null && parsed.pending === true;
  } catch {
    return false;
  }
}

function textOfMessage(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Side-effect-free state machine. Timers and notification delivery are
 * injected so tests stay synchronous.
 *
 * @param {object} options
 * @param {number} [options.minSeconds]       minimum turn length worth a "done" toast
 * @param {number} [options.snippetChars]     body budget
 * @param {number} [options.approvalDelayMs]  grace period before nagging about approval
 * @param {number} [options.questionDelayMs]  grace period before nagging about a question
 * @param {(note: {kind: string, title: string, body: string}) => void} [options.onNotify]
 * @param {(fn: () => void, ms: number) => unknown} [options.schedule]
 * @param {(handle: unknown) => void} [options.cancel]
 * @param {() => number} [options.now]
 */
export function createAutoNotify({
  minSeconds = 10,
  snippetChars = 140,
  approvalDelayMs = 1500,
  questionDelayMs = 2000,
  onNotify = () => {},
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (handle) => clearTimeout(handle),
  now = () => Date.now(),
} = {}) {
  const sessions = new Map();

  function newState() {
    return {
      startedAt: null,
      lastText: "",
      notifiedByTool: false,
      approvalNotified: false,
      questionNotified: false,
      /** callId -> { text, timer } for unanswered question calls */
      asks: new Map(),
      /** callId -> question text whose tool result came back `pending` */
      pendingAsks: new Map(),
      /** approvalId -> { toolName, reason, timer } */
      approvals: new Map(),
    };
  }

  function stateOf(session) {
    const id = session?.id;
    if (id === undefined) return null;
    let state = sessions.get(id);
    if (!state) {
      state = newState();
      sessions.set(id, state);
    }
    return state;
  }

  function clearTimers(state) {
    for (const ask of state.asks.values()) cancel(ask.timer);
    for (const approval of state.approvals.values()) cancel(approval.timer);
    state.asks.clear();
    state.approvals.clear();
  }

  function approvalNote(state) {
    if (state.approvals.size === 0) return null;
    const entries = [...state.approvals.values()];
    const tools = [...new Set(entries.map((entry) => entry.toolName).filter(Boolean))];
    const what = tools.length === 0 ? "工具调用" : tools.join("、");
    const reason = entries.find((entry) => entry.reason)?.reason;
    const suffix = reason ? `：${toSnippet(reason, 100)}` : "";
    const body = entries.length > 1
      ? `${entries.length} 个请求等待授权（${what}）${suffix}`
      : `${what} 请求授权${suffix}`;
    return { kind: "approval", title: "DSH 需要授权", body };
  }

  function flushApprovals(state) {
    const note = approvalNote(state);
    for (const entry of state.approvals.values()) cancel(entry.timer);
    state.approvals.clear();
    state.approvalNotified = true;
    if (note) onNotify(note);
  }

  function questionNote(text) {
    return {
      kind: "question",
      title: "DSH 等待你的选择",
      body: text ? toSnippet(text, snippetChars) : "有提问等待你在会话中确认",
    };
  }

  return {
    /** Feed one `session/event`. */
    observe(session, event) {
      if (!event || typeof event.type !== "string") return;
      const state = stateOf(session);
      if (!state) return;

      switch (event.type) {
        case "turn/start": {
          // A new turn cannot still be waiting on last turn's question.
          for (const ask of state.asks.values()) cancel(ask.timer);
          state.asks.clear();
          state.pendingAsks.clear();
          state.startedAt = now();
          state.lastText = "";
          state.notifiedByTool = false;
          state.approvalNotified = false;
          state.questionNotified = false;
          break;
        }
        case "assistant/message": {
          const text = textOfMessage(event.data?.message);
          if (text) state.lastText = text;
          break;
        }
        case "tool/call": {
          const called = event.data?.name;
          if (called === NOTIFY_TOOL) {
            state.notifiedByTool = true;
          } else if (called === ASK_TOOL) {
            const callId = event.data?.callId;
            if (callId === undefined || state.asks.has(callId)) break;
            const text = questionText(event.data?.arguments);
            const entry = { text, timer: null };
            entry.timer = schedule(() => {
              if (!state.asks.has(callId)) return;
              state.asks.delete(callId);
              state.questionNotified = true;
              onNotify(questionNote(text));
            }, questionDelayMs);
            state.asks.set(callId, entry);
          }
          break;
        }
        case "tool/result": {
          const callId = event.data?.message?.toolCallId;
          if (callId === undefined) break;
          const ask = state.asks.get(callId);
          if (ask) {
            cancel(ask.timer);
            state.asks.delete(callId);
            if (isPendingToolResult(event.data?.message)) {
              state.pendingAsks.set(callId, ask.text);
            }
          }
          break;
        }
        case "approval/asked": {
          const id = event.data?.id;
          if (id === undefined || state.approvals.has(id)) break;
          const entry = {
            toolName: String(event.data?.toolName ?? "工具调用"),
            reason: typeof event.data?.reason === "string" ? event.data.reason : "",
            timer: null,
          };
          entry.timer = schedule(() => {
            if (!state.approvals.has(id)) return;
            flushApprovals(state);
          }, approvalDelayMs);
          state.approvals.set(id, entry);
          break;
        }
        case "approval/decided": {
          const id = event.data?.id;
          const entry = state.approvals.get(id);
          if (entry) {
            cancel(entry.timer);
            state.approvals.delete(id);
          }
          break;
        }
        default:
          break;
      }
    },

    /**
     * Call when the agent reached `idle`. Returns the notification to send, or
     * null when this turn does not deserve one.
     *
     * @param {object} session
     * @param {{ force?: boolean }} [options]
     */
    finish(session, { force = false } = {}) {
      const id = session?.id;
      const state = sessions.get(id);
      if (!state) return null;

      const openAsk = [...state.asks.values(), ...[...state.pendingAsks.values()].map((text) => ({ text }))]
        .find((ask) => ask.text)?.text ?? null;

      const approvalsPending = state.approvals.size > 0;
      clearTimers(state);
      sessions.delete(id);

      // A question the human still owes an answer to is urgent, even for a
      // subagent and even when the turn itself was short.
      if (openAsk !== null && !state.questionNotified) return questionNote(openAsk);

      if (isSubagentSession(session)) return null;
      if (state.notifiedByTool || state.approvalNotified || approvalsPending) return null;

      const durationSeconds = state.startedAt === null ? 0 : (now() - state.startedAt) / 1000;
      if (!force && durationSeconds < minSeconds) return null;
      if (!state.lastText && !force) return null;

      return {
        kind: "done",
        title: "DSH 任务完成",
        body: toSnippet(state.lastText, snippetChars) || "本轮已结束",
      };
    },

    /** Drop all bookkeeping for a session (agent disposal). */
    forget(session) {
      const id = session?.id;
      const state = sessions.get(id);
      if (!state) return;
      clearTimers(state);
      sessions.delete(id);
    },
  };
}
