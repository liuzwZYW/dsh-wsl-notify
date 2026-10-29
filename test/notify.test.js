import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUMID,
  buildNotifyScript,
  buildToastScript,
  buildWinRtToastScript,
  encodeTitleBody,
  formatNotifyResult,
  normalizeMode,
} from "../lib/notify.js";

describe("win_notify", () => {
  it("encodes utf8", () => {
    const { titleB64, bodyB64 } = encodeTitleBody("完成", "ok");
    assert.equal(Buffer.from(titleB64, "base64").toString("utf8"), "完成");
    assert.match(buildNotifyScript(titleB64, bodyB64), /MessageBox/);
  });

  it("builds toast BalloonTip script", () => {
    const { titleB64, bodyB64 } = encodeTitleBody("T", "B");
    assert.match(buildToastScript(titleB64, bodyB64), /ShowBalloonTip/);
    assert.match(buildToastScript(titleB64, bodyB64), /NotifyIcon/);
  });

  it("builds a WinRT toast with the brand identity and a per-kind icon", () => {
    const { titleB64, bodyB64 } = encodeTitleBody("T", "B");
    const done = buildWinRtToastScript(titleB64, bodyB64, "done");
    assert.match(done, /ToastGeneric/);
    assert.match(done, /appLogoOverride/);
    assert.match(done, /done\.png/);
    assert.match(done, /deepseek HARNESS\.lnk/);
    assert.match(done, new RegExp(AUMID.replace(".", "\\.")));
    assert.match(buildWinRtToastScript(titleB64, bodyB64, "question"), /question\.png/);
    assert.match(buildWinRtToastScript(titleB64, bodyB64, "approval"), /approval\.png/);
    assert.match(buildWinRtToastScript(titleB64, bodyB64, "unknown"), /done\.png/);
  });

  it("normalizes mode", () => {
    assert.equal(normalizeMode("toast"), "toast");
    assert.equal(normalizeMode("messagebox"), "messagebox");
    assert.equal(normalizeMode(undefined), "messagebox");
  });

  it("formats", () => {
    assert.match(formatNotifyResult({ ok: true, title: "T", mode: "toast" }), /notified: T mode=toast/);
  });
});
