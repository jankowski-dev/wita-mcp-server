# screenshot.ps1 - capture the full screen to PNG for coordinate planning
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32Fg {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$proc = Get-Process Bazis | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$hwnd = $proc.MainWindowHandle
[void][Win32Fg]::ShowWindow($hwnd, 9)
[void][Win32Fg]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 500

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap ([int]$bounds.Width), ([int]$bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)
$out = Join-Path $PSScriptRoot "basis_window.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("screen: " + $bounds.Width + "x" + $bounds.Height)
Write-Output ("saved: " + $out)
