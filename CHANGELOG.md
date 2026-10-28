# Changelog

## 0.2.0 (fork @liuzw/dsh-wsl-notify)

- Forked from 173787247/dsh-wsl-notify 0.1.1 and republished under the
  `@liuzw` scope as a bundle id `wsl-notify`, so the upstream package no longer
  overwrites it on reinstall.


Deterministic notifications — no longer depends on the model remembering to
call `win_notify`.

- **Auto "finished" toast** when a top-level turn goes idle after
  `autoMinSeconds` of work, with the reply snippet as the body.
- **Auto "waiting for your choice" toast** when `ask_user_question` is still
  unanswered at turn end, with the question text as the body.
- **Auto "needs approval" toast** when `approval/asked` stays undecided for
  `approvalDelayMs`; quick or auto-approved requests stay silent and parallel
  requests coalesce into one toast.
- Subagent sessions never emit completion toasts, but their questions and
  approval requests do notify.
- If the turn already called `win_notify`, the automatic toast is suppressed.
- New config: `autoNotify`, `autoMode`, `autoMinSeconds`, `autoSnippetChars`,
  `approvalDelayMs`.
- `win_notify` keeps its 0.1.x contract; `mode=toast` remains the non-blocking
  balloon and falls back to MessageBox.

## 0.1.1

- Toast mode (`NotifyIcon` BalloonTip) with MessageBox fallback.

## 0.1.0

- Initial `win_notify` tool (blocking MessageBox).
