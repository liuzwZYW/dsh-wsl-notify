# @liuzw/dsh-wsl-notify

Fork of [`173787247/dsh-wsl-notify`](https://github.com/173787247/dsh-wsl-notify)
(0.1.1, MIT), maintained by liuzw. Adds **deterministic notifications** — the
0.2.0 feature that upstream does not have.

> Why the fork: upstream only registers a tool plus a soft prompt hint, so most
> finished tasks went unannounced. The fork watches the session event stream and
> notifies on its own. It also installs as its own package, so reinstalling the
> upstream plugin no longer overwrites it.

## What it does

| Trigger | Title | Body |
|---|---|---|
| Top-level turn goes idle after >= `autoMinSeconds` | `DSH 任务完成` | reply snippet |
| `ask_user_question` still unanswered after `questionDelayMs` | `DSH 等待你的选择` | the question |
| `approval/asked` undecided for `approvalDelayMs` | `DSH 需要授权` | tool name + reason |

- Toast (non-blocking balloon) by default; `autoMode: messagebox` for a dialog.
- Subagent sessions never emit completion toasts, but their questions and
  approval requests do notify.
- If the turn already called `win_notify`, the automatic toast is suppressed.
- Quick decisions stay silent; parallel approvals coalesce into one toast.

## Toast identity

The notification is a real Windows toast under our own AppUserModelID, so the
header reads **[whale mark] deepseek HARNESS** — the bare mark, no badge box —
instead of "Windows PowerShell 5.1", and the big icon reflects what happened:

| Kind | Icon |
|---|---|
| `done` | green check |
| `question` | blue question mark |
| `approval` | amber exclamation |

On the first notification the plugin writes the icons to
`%LOCALAPPDATA%\DSH\notify\icons` and creates
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\deepseek HARNESS.lnk`
(the shortcut is what registers the app id — Windows drops toasts from an
unregistered one). If the toast path fails it falls back to the legacy balloon
tip, then to MessageBox.

## Tool

`win_notify` is still registered for explicit, extra alerts.

| Param | Default | Meaning |
|---|---|---|
| `title` | `DSH` | Window / balloon title |
| `body` | `Task finished.` | Message body |
| `mode` | `messagebox` | `toast` or `messagebox` |

## Install

Local link (recommended for this machine — edits take effect on restart):

```sh
dsh plugin --profile web add link:/root/Work/dsh/dsh-wsl-notify
dsh plugin --profile web remove dsh-wsl-notify   # drop the upstream install
```

From git:

```sh
dsh plugin --profile web add github:liuzwZYW/dsh-wsl-notify
```

## Configuration

```yaml
- id: wsl-notify
  name: '@liuzw/dsh-wsl-notify'
  config:
    timeoutMs: 30000
    maxLen: 500
    autoNotify: true
    autoMode: toast
    autoMinSeconds: 10
    autoSnippetChars: 140
    approvalDelayMs: 1500
    questionDelayMs: 2000
```

## Tests

```sh
npm test        # state machine unit tests
npm run smoke   # applies the plugin to a fake context
```

## License

MIT. Original work (c) 173787247; fork changes by liuzw.
