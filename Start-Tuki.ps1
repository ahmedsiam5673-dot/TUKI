# Start-Tuki.ps1: one-click setup + launch for Tuki on Windows.
# Run it through Start-Tuki.bat (double-click). Safe to run again and again:
# anything already installed is skipped, and once Tuki is built it just starts it.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$exe = Join-Path $PSScriptRoot "src-tauri\target\release\tuki.exe"

function Say($msg)  { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host $msg -ForegroundColor Yellow }

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user    = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user;$env:USERPROFILE\.cargo\bin"
}

function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Winget-Install($id, $extra) {
    $args = @("install", "--id", $id, "-e", "--accept-source-agreements", "--accept-package-agreements")
    if ($extra) { $args += $extra }
    & winget @args
    # 0 = installed, -1978335189 = already installed / nothing to do. Anything else is checked by the caller.
}

function Vs-Install-Path {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) { return $null }
    $p = & $vswhere -products * -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($p) { return $p }
    return $null
}

function Start-Tuki {
    Say "Starting Tuki"
    Start-Process -FilePath $exe
    Write-Host "Tuki is running at the top of your screen (tray icon has Quit)."
}

try {
    # ---- Fast path: already built --------------------------------------------
    if (Test-Path $exe) {
        Start-Tuki
        return
    }

    Write-Host "First run: Tuki will install what it needs and build itself." -ForegroundColor Green
    Write-Host "This can take 15-30 minutes. Windows may ask for permission (UAC) a few times: click Yes."

    if (-not (Have "winget")) {
        throw "winget was not found. Update 'App Installer' from the Microsoft Store, or install Node.js, Rust and Visual Studio Build Tools (C++) by hand, then run this again."
    }

    # ---- 1. Node.js ------------------------------------------------------------
    Refresh-Path
    if (-not (Have "node")) {
        Say "Installing Node.js (LTS)"
        Winget-Install "OpenJS.NodeJS.LTS"
        Refresh-Path
        if (-not (Have "node")) { throw "Node.js install did not finish. Install it from https://nodejs.org and run this again." }
    } else { Write-Host "Node.js: ok" }

    # ---- 2. Rust ---------------------------------------------------------------
    if (-not (Have "cargo")) {
        Say "Installing Rust"
        Winget-Install "Rustlang.Rustup"
        Refresh-Path
        if (Have "rustup") { & rustup default stable-msvc }
        Refresh-Path
        if (-not (Have "cargo")) { throw "Rust install did not finish. Install it from https://rustup.rs and run this again." }
    } else { Write-Host "Rust: ok" }

    # ---- 3. Visual Studio Build Tools (C++) -----------------------------------
    if (-not (Vs-Install-Path)) {
        Say "Installing Visual Studio Build Tools with C++ (this is the big one)"
        $override = "--passive --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
        Winget-Install "Microsoft.VisualStudio.2022.BuildTools" @("--override", $override)

        if (-not (Vs-Install-Path)) {
            # Build Tools may exist without the C++ workload: add it.
            $vsRoot = & (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe") -products * -latest -property installationPath
            $setup  = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\setup.exe"
            if ($vsRoot -and (Test-Path $setup)) {
                Say "Adding the C++ workload to the existing Build Tools"
                & $setup modify --installPath $vsRoot --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart --wait
            }
        }
        if (-not (Vs-Install-Path)) { throw "C++ Build Tools are still missing. Install 'Desktop development with C++' from the Visual Studio Installer and run this again." }
    } else { Write-Host "C++ Build Tools: ok" }

    # ---- 4. WebView2 (almost always present already) --------------------------
    $wv = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
    if (-not $wv) {
        Say "Installing WebView2 runtime"
        Winget-Install "Microsoft.EdgeWebView2Runtime"
    }

    # ---- 5. Build ---------------------------------------------------------------
    Refresh-Path
    Say "Installing JavaScript packages"
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

    Say "Building the hook relay"
    & npm run hook
    if ($LASTEXITCODE -ne 0) { throw "Hook build failed." }

    Say "Building Tuki (the first build is slow)"
    & npx tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "Tuki build failed. Scroll up to see the error." }
    if (-not (Test-Path $exe)) { throw "Build finished but tuki.exe was not found at $exe" }

    # ---- 6. Claude Code hooks ----------------------------------------------------
    Say "Connecting Tuki to Claude Code"
    Write-Host "This adds Tuki's hooks to ~/.claude/settings.json (a backup is made first, your own hooks are kept)."
    $a = Read-Host "Do it now? [Y/n]"
    if ($a -eq "" -or $a -match "^[Yy]") {
        & node scripts/install-hooks.mjs
        if ($LASTEXITCODE -ne 0) { Warn "Could not install hooks. You can run: npm run install-hooks" }
    } else {
        Write-Host "Skipped. Later you can run: npm run install-hooks"
    }

    # ---- 7. Shortcuts --------------------------------------------------------------
    $shell = New-Object -ComObject WScript.Shell
    function Make-Shortcut($path) {
        $s = $shell.CreateShortcut($path)
        $s.TargetPath = $exe
        $s.WorkingDirectory = Split-Path $exe
        $s.Save()
    }
    Make-Shortcut (Join-Path ([Environment]::GetFolderPath("Desktop")) "Tuki.lnk")
    Write-Host "Desktop shortcut created."

    $b = Read-Host "Start Tuki automatically when Windows starts? [y/N]"
    if ($b -match "^[Yy]") {
        Make-Shortcut (Join-Path ([Environment]::GetFolderPath("Startup")) "Tuki.lnk")
        Write-Host "Added to Startup."
    }

    Start-Tuki
    Write-Host ""
    Write-Host "Done. Start a NEW Claude Code session so it picks up the hooks." -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "Something went wrong:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Fix it (or send this message to Claude) and double-click Start-Tuki.bat again; finished steps are skipped."
}
