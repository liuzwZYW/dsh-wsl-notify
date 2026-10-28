import { detectWsl, runPowerShell } from "./lib/wsl-host.js";
import {
  buildNotifyScript,
  buildToastScript,
  encodeTitleBody,
  formatNotifyResult,
  normalizeMode,
} from "./lib/notify.js";
import { createAutoNotify } from "./lib/auto-notify.js";

export const name = "dsh-wsl-notify";
export const inject = ["tools", "systemPrompt"];

export function apply(ctx, config = {}) {
  const timeoutMs = positive(config.timeoutMs, 30_000);
  const maxLen = positive(config.maxLen, 500);
  const wsl = detectWsl();

  const notify = createNotifier({ wsl, timeoutMs });
  const autoMode = normalizeMode(config.autoMode ?? "toast");
  const autoEnabled = config.autoNotify !== false;

  ctx.systemPrompt.section({
    name: "tool:win_notify",
    order: 123,
    text: [
      "Use win_notify to show a short Windows notification from WSL. mode=messagebox (default, blocking) or mode=toast (BalloonTip, non-blocking; falls back to MessageBox).",
      "The plugin already notifies automatically when a top-level turn finishes after real work, when ask_user_question is waiting on the human, and when a tool call needs approval.",
      "So do NOT call win_notify just to announce routine completion; call it only for an extra or earlier alert the human asked for. Keep title/body brief; no secrets.",
    ].join(" "),
  });

  ctx.tools.register({
    name: "win_notify",
    description: "Show a Windows notification from WSL: MessageBox (default, blocking) or toast BalloonTip (non-blocking).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", description: "Window / balloon title (default DSH)." },
        body: { type: "string", description: "Message body." },
        mode: {
          type: "string",
          enum: ["toast", "messagebox"],
          description: "toast = NotifyIcon BalloonTip (non-blocking); messagebox = blocking MessageBox (default).",
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean" },
          title: { type: "string" },
          mode: { type: "string" },
          error: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: formatNotifyResult(value) }],
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      if (!wsl) return { ok: false, error: "not running in WSL" };
      const title = String(args?.title ?? "DSH").slice(0, maxLen);
      const body = String(args?.body ?? "Task finished.").slice(0, maxLen);
      const mode = normalizeMode(args?.mode);
      const result = await notify(title, body, mode);
      return { ...result, title };
    },
    presentCall: () => ({ card: "generic", title: "Windows notify" }),
    presentResult: (_args, result) => (
      result.isError
        ? { card: "generic", title: "Windows notify failed", content: result.content }
        : { card: "generic", title: "Windows notify", content: result.content }
    ),
  });

  if (!autoEnabled) return;
  if (!wsl) {
    ctx.logger?.info?.("dsh-wsl-notify: not running in WSL; auto notifications disabled");
    return;
  }

  const sendAuto = (note) => {
    // Fire-and-forget: a notification must never stall the agent.
    notify(note.title.slice(0, maxLen), note.body.slice(0, maxLen), autoMode)
      .then((result) => {
        if (!result.ok) ctx.logger?.warn?.(`dsh-wsl-notify: auto notification failed: ${result.error}`);
      })
      .catch((err) => {
        ctx.logger?.warn?.(`dsh-wsl-notify: auto notification failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  };

  const auto = createAutoNotify({
    minSeconds: nonNegative(config.autoMinSeconds, 10),
    snippetChars: positive(config.autoSnippetChars, 140),
    approvalDelayMs: nonNegative(config.approvalDelayMs, 1500),
    questionDelayMs: nonNegative(config.questionDelayMs, 2000),
    onNotify: sendAuto,
  });

  ctx.on("session/event", (session, event) => {
    try {
      auto.observe(session, event);
    } catch (err) {
      ctx.logger?.warn?.(`dsh-wsl-notify: observe failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  ctx.on("agent/status", ({ agent, status }) => {
    if (status !== "idle") return;
    const session = agent?.session;
    if (!session) return;
    try {
      const note = auto.finish(session);
      if (note) sendAuto(note);
    } catch (err) {
      ctx.logger?.warn?.(`dsh-wsl-notify: finish failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  ctx.on("agent/disposed", ({ agent }) => {
    const session = agent?.session;
    if (session) auto.forget(session);
  });
}

/**
 * Send one notification through PowerShell.
 * @returns {Promise<{ok: boolean, mode?: string, error?: string}>}
 */
function createNotifier({ wsl, timeoutMs }) {
  return async function send(title, body, mode) {
    if (!wsl) return { ok: false, error: "not running in WSL" };
    const { titleB64, bodyB64 } = encodeTitleBody(title, body);
    try {
      if (mode === "toast") {
        try {
          await runPowerShell(buildToastScript(titleB64, bodyB64), { timeoutMs });
          return { ok: true, mode: "toast" };
        } catch {
          await runPowerShell(buildNotifyScript(titleB64, bodyB64), { timeoutMs });
          return { ok: true, mode: "messagebox" };
        }
      }
      await runPowerShell(buildNotifyScript(titleB64, bodyB64), { timeoutMs });
      return { ok: true, mode: "messagebox" };
    } catch (err) {
      return { ok: false, mode, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonNegative(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
