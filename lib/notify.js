import { ICON_FILE_BY_KIND, TOAST_ICONS } from "./icons.js";

/** AppUserModelID registered through a Start Menu shortcut; drives the toast name. */
export const AUMID = "liuzw.DSH";

export function encodeTitleBody(title, body) {
  return {
    titleB64: Buffer.from(String(title ?? "DSH"), "utf8").toString("base64"),
    bodyB64: Buffer.from(String(body ?? ""), "utf8").toString("base64"),
  };
}

function decodeVars(titleB64, bodyB64) {
  const t = String(titleB64).replace(/'/g, "''");
  const b = String(bodyB64).replace(/'/g, "''");
  return [
    `$title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${t}'))`,
    `$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b}'))`,
  ];
}

/** Blocking MessageBox (reliable fallback). */
export function buildNotifyScript(titleB64, bodyB64) {
  return [
    "Add-Type -AssemblyName System.Windows.Forms",
    ...decodeVars(titleB64, bodyB64),
    "[Windows.Forms.MessageBox]::Show($body, $title, 'OK', 'Information') | Out-Null",
    "'ok'",
  ].join("; ");
}

/**
 * Legacy fallback: a tray BalloonTip rendered by the shell.
 * It carries the host process identity ("Windows PowerShell 5.1"), so it is
 * only used when the WinRT toast path fails.
 */
export function buildToastScript(titleB64, bodyB64) {
  return [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    ...decodeVars(titleB64, bodyB64),
    "$ni = New-Object System.Windows.Forms.NotifyIcon",
    "$ni.Icon = [System.Drawing.SystemIcons]::Information",
    "$ni.Visible = $true",
    "$ni.BalloonTipTitle = $title",
    "$ni.BalloonTipText = $(if ([string]::IsNullOrEmpty($body)) { ' ' } else { $body })",
    "$ni.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info",
    "$ni.ShowBalloonTip(4000)",
    "Start-Sleep -Milliseconds 4500",
    "$ni.Visible = $false",
    "$ni.Dispose()",
    "'ok'",
  ].join("; ");
}

const AUMID_INTEROP = `using System;
using System.Runtime.InteropServices;

public static class AumidSetter {
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint cProps);
    [PreserveSig] int GetAt(uint iProp, out PROPERTYKEY pkey);
    [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
    [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
    [PreserveSig] int Commit();
  }

  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PROPERTYKEY { public Guid fmtid; public uint pid; }

  [StructLayout(LayoutKind.Explicit)]
  public struct PROPVARIANT {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pointerValue;
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern IPropertyStore SHGetPropertyStoreFromParsingName(string path, IntPtr pbc, int flags, ref Guid riid);

  public static void Set(string lnkPath, string aumid) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    var store = SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, 2, ref iid);
    var key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    var pv = new PROPVARIANT { vt = 31, pointerValue = Marshal.StringToCoTaskMemUni(aumid) };
    try {
      // S_FALSE (1) means the value was already set; only negative HRESULTs fail.
      int hr = store.SetValue(ref key, ref pv);
      if (hr < 0) throw new Exception("SetValue hr=0x" + hr.ToString("X8"));
      hr = store.Commit();
      if (hr < 0) throw new Exception("Commit hr=0x" + hr.ToString("X8"));
    } finally {
      Marshal.FreeCoTaskMem(pv.pointerValue);
    }
  }
}`;

/**
 * Real Windows toast (ToastGeneric) shown under our own AppUserModelID.
 *
 * Unlike a balloon tip this carries a custom source name ("DSH") and a
 * per-notification icon (`appLogoOverride`), and it is not tied to the
 * powershell.exe identity. The first call also installs the icons and the
 * Start Menu shortcut that registers the AUMID (Windows drops toasts from an
 * unregistered app id).
 *
 * @param {string} titleB64
 * @param {string} bodyB64
 * @param {keyof typeof ICON_FILE_BY_KIND} [kind]
 */
export function buildWinRtToastScript(titleB64, bodyB64, kind = "done") {
  const icon = ICON_FILE_BY_KIND[kind] ?? ICON_FILE_BY_KIND.done;
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    `$appId = '${AUMID}'`,
    "$dir = Join-Path $env:LOCALAPPDATA 'DSH\\notify'",
    "$icons = Join-Path $dir 'icons'",
    "New-Item -ItemType Directory -Force -Path $icons | Out-Null",
    `[IO.File]::WriteAllBytes((Join-Path $icons 'done.png'), [Convert]::FromBase64String('${TOAST_ICONS.done}'))`,
    `[IO.File]::WriteAllBytes((Join-Path $icons 'question.png'), [Convert]::FromBase64String('${TOAST_ICONS.question}'))`,
    `[IO.File]::WriteAllBytes((Join-Path $icons 'approval.png'), [Convert]::FromBase64String('${TOAST_ICONS.approval}'))`,
    `[IO.File]::WriteAllBytes((Join-Path $icons 'dsh.ico'), [Convert]::FromBase64String('${TOAST_ICONS.shortcut}'))`,
    // The displayed source name is the shortcut file name.
    "$legacy = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\DSH.lnk'",
    "if (Test-Path $legacy) { Remove-Item $legacy -Force }",
    "$lnk = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\deepseek HARNESS.lnk'",
    // Bump the marker whenever the registered icon/name changes.
    "$marker = Join-Path $icons '.v3'",
    "if (-not (Test-Path $lnk) -or -not (Test-Path $marker)) {",
    "  $shell = New-Object -ComObject WScript.Shell",
    "  $sc = $shell.CreateShortcut($lnk)",
    "  $sc.TargetPath = (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe')",
    "  $sc.Arguments = '-NoProfile -WindowStyle Hidden -Command \"exit\"'",
    "  $sc.IconLocation = (Join-Path $icons 'dsh.ico')",
    "  $sc.Description = 'deepseek HARNESS notifications'",
    "  $sc.Save()",
    "  Add-Type -TypeDefinition @'",
    AUMID_INTEROP,
    "'@",
    "  [AumidSetter]::Set($lnk, $appId)",
    "  Set-Content -Path $marker -Value '3'",
    "}",
    ...decodeVars(titleB64, bodyB64),
    "$src = 'file:///' + ((Join-Path $icons '" + icon + "') -replace '\\\\', '/')",
    "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$doc.LoadXml('<toast><visual><binding template=\"ToastGeneric\"><text id=\"1\"></text><text id=\"2\"></text><image placement=\"appLogoOverride\" hint-crop=\"circle\" src=\"' + $src + '\"/></binding></visual></toast>')",
    "$texts = $doc.GetElementsByTagName('text')",
    "$texts.Item(0).InnerText = $title",
    "$texts.Item(1).InnerText = $(if ([string]::IsNullOrEmpty($body)) { ' ' } else { $body })",
    "$toast = New-Object Windows.UI.Notifications.ToastNotification $doc",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)",
    "'ok'",
  ].join("\n");
}


/** Prefer toast via BurntToast if present; MessageBox is the reliable fallback we ship. */
export function formatNotifyResult(value) {
  if (!value.ok) return `win_notify failed: ${value.error}`;
  const mode = value.mode ? ` mode=${value.mode}` : "";
  return `notified: ${value.title}${mode}`;
}

export function normalizeMode(mode) {
  const m = String(mode ?? "messagebox").trim().toLowerCase();
  return m === "toast" ? "toast" : "messagebox";
}
