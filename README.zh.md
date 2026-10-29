# @liuzw/dsh-wsl-notify

[`173787247/dsh-wsl-notify`](https://github.com/173787247/dsh-wsl-notify)（0.1.1，MIT）的 fork，
由 liuzw 维护。补上了上游没有的 **0.2.0 自动通知**。

> 为什么要 fork：上游只注册工具加一句软提示，任务跑完经常没有任何通知。本 fork 监听会话
> 事件流自行判断。同时它作为独立包安装，重新安装上游插件不会再把这份代码覆盖掉。

## 行为

| 触发 | 标题 | 正文 |
|---|---|---|
| 顶层 turn 结束且 ≥ `autoMinSeconds` | `DSH 任务完成` | 最后回复摘要 |
| `ask_user_question` 超过 `questionDelayMs` 未答 | `DSH 等待你的选择` | 问题正文 |
| `approval/asked` 超过 `approvalDelayMs` 未决 | `DSH 需要授权` | 工具名 + 原因 |

- 默认 **toast 气泡**（非阻塞）；`autoMode: messagebox` 可换阻塞弹窗。
- 子代理不再弹“完成”，但它们的提问与授权请求照样通知。
- 本轮已调过 `win_notify` 则不重复弹。
- 宽限期内被答掉/批掉的请求不弹；并行授权合并为一条。

## 通知身份（标题栏）

发的是真正的 Windows toast，走自己的 AppUserModelID，所以标题栏显示的是
**「鲸鱼图标 + deepseek HARNESS」**，不再是 “Windows PowerShell 5.1”；左侧大图标按事件区分：

| 类型 | 图标 |
|---|---|
| `done` | 绿色对勾 |
| `question` | 蓝色问号 |
| `approval` | 橙色感叹号 |

首次发通知时，插件会把图标写到 `%LOCALAPPDATA%\DSH\notify\icons`，并创建
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\deepseek HARNESS.lnk`
（快捷方式负责注册 app id —— 未注册的 id 发给系统会被直接丢弃）。toast 失败时退回旧的
气泡通知，再失败才用 MessageBox。

## 工具

`win_notify` 保留，用于额外/更早的提醒。

| 参数 | 默认 | 含义 |
|---|---|---|
| `title` | `DSH` | 窗口 / 气泡标题 |
| `body` | `Task finished.` | 正文 |
| `mode` | `messagebox` | `toast` 或 `messagebox` |

## 安装

本机推荐 link（改源码后重启即生效）：

```sh
dsh plugin --profile web add link:/root/Work/dsh/dsh-wsl-notify
dsh plugin --profile web remove dsh-wsl-notify   # 移除上游那份
```

从 git 安装：

```sh
dsh plugin --profile web add github:liuzwZYW/dsh-wsl-notify
```

## 配置

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

## 测试

```sh
npm test        # 状态机单测
npm run smoke   # 用假 ctx 走一遍 apply()
```

## 许可

MIT。原始实现 (c) 173787247；fork 修改 by liuzw。
