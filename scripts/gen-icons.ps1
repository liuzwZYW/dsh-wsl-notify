# Regenerate assets/done.png, assets/question.png, assets/approval.png.
# Run on Windows (PowerShell 5.1) from the repository root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-icons.ps1
# The result is then inlined into lib/icons.js by scripts/embed-icons.mjs.
param([string]$Out = (Join-Path $PSScriptRoot '..\assets'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$size = 128
function New-Icon($file, $r, $g, $b, $glyph) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $gr = [System.Drawing.Graphics]::FromImage($bmp)
  $gr.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $gr.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $gr.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $r, $g, $b))
  $gr.FillEllipse($brush, 2, 2, $size - 4, $size - 4)
  $font = New-Object System.Drawing.Font('Segoe UI Symbol', 62, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, -6, $size, $size)
  $gr.DrawString($glyph, $font, [System.Drawing.Brushes]::White, $rect, $fmt)
  $bmp.Save((Join-Path $Out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $gr.Dispose(); $bmp.Dispose()
}
New-Icon 'done.png' 47 179 68 ([char]0x2714)
New-Icon 'question.png' 47 111 235 '?'
New-Icon 'approval.png' 224 161 0 '!'
Write-Output "icons written to $Out"
