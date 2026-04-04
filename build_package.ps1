#Requires -Version 5.1
<#
.SYNOPSIS
    Package IDE extensions for distribution.
.DESCRIPTION
    Builds the VS Code extension (.vsix) and/or the Rider/JetBrains plugin (.zip).
    If no options are specified, both packages are built.
.PARAMETER VSCode
    Build the VS Code extension (.vsix).
.PARAMETER Rider
    Build the Rider/JetBrains plugin (.zip).
.EXAMPLE
    .\build_package.ps1
    Builds both packages.
.EXAMPLE
    .\build_package.ps1 -VSCode
    Builds only the VS Code extension.
.EXAMPLE
    .\build_package.ps1 -Rider
    Builds only the Rider plugin.
#>
[CmdletBinding()]
param(
    [switch]$VSCode,
    [switch]$Rider
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Default: build both if neither flag was provided
if (-not $VSCode -and -not $Rider) {
    $VSCode = $true
    $Rider = $true
}

$Failed = 0

# ──────────────────────────────────────────────
#  Pre-requisite checks
# ──────────────────────────────────────────────
function Test-Prerequisite {
    param(
        [string]$Command,
        [string]$Label,
        [string]$VersionArg = '--version',
        [string[]]$InstallHint
    )
    $cmd = Get-Command $Command -ErrorAction SilentlyContinue
    if ($cmd) {
        try {
            $ver = & $Command $VersionArg 2>&1 | Select-Object -First 1
        }
        catch {
            $ver = '(unable to determine version)'
        }
        Write-Host "  OK $Label found: $ver"
        return $true
    }
    else {
        Write-Host "  MISSING: $Label is NOT installed (or not on PATH)." -ForegroundColor Red
        foreach ($hint in $InstallHint) {
            Write-Host "    $hint" -ForegroundColor Yellow
        }
        return $false
    }
}

$PrereqOk = $true

Write-Host ''
Write-Host '========================================'
Write-Host ' Checking pre-requisites'
Write-Host '========================================'

if ($VSCode) {
    Write-Host ''
    Write-Host 'VS Code extension requires: Node.js (npm), Git'

    if (-not (Test-Prerequisite -Command 'node' -Label 'Node.js' `
                -InstallHint @(
                'Download Node.js 22.x LTS: https://nodejs.org/',
                'Or install via winget:     winget install OpenJS.NodeJS.LTS',
                'Or via Chocolatey:         choco install nodejs-lts'
            ))) { $PrereqOk = $false }

    if (-not (Test-Prerequisite -Command 'npm' -Label 'npm' `
                -InstallHint @(
                'npm is included with Node.js - install Node.js to get it.',
                'Download Node.js 22.x LTS: https://nodejs.org/'
            ))) { $PrereqOk = $false }

    if (-not (Test-Prerequisite -Command 'git' -Label 'Git' `
                -InstallHint @(
                'Download Git: https://git-scm.com/download/win',
                'Or install via winget: winget install Git.Git',
                'Or via Chocolatey:     choco install git'
            ))) { $PrereqOk = $false }
}

if ($Rider) {
    Write-Host ''
    Write-Host 'Rider plugin requires: JDK 17+'

    if (-not (Test-Prerequisite -Command 'java' -Label 'Java' -VersionArg '-version' `
                -InstallHint @(
                'Download JDK 17+: https://adoptium.net/',
                'Or install via winget: winget install EclipseAdoptium.Temurin.17.JDK',
                'Or via Chocolatey:     choco install temurin17'
            ))) { $PrereqOk = $false }

    if (-not (Test-Prerequisite -Command 'javac' -Label 'javac' -VersionArg '-version' `
                -InstallHint @(
                'javac is included with the JDK - install a full JDK (not just a JRE).',
                'Download JDK 17+: https://adoptium.net/'
            ))) { $PrereqOk = $false }

    # Verify Java version >= 17
    $javaCmd = Get-Command java -ErrorAction SilentlyContinue
    if ($javaCmd) {
        $javaVerOutput = & java -version 2>&1 | Select-Object -First 1
        if ($javaVerOutput -match '"(\d+)') {
            $javaMajor = [int]$Matches[1]
            if ($javaMajor -lt 17) {
                Write-Host "  WARNING: Java version $javaMajor detected - JDK 17 or later is required." -ForegroundColor Yellow
                Write-Host "    Download JDK 17+: https://adoptium.net/" -ForegroundColor Yellow
                Write-Host "    Or install via winget: winget install EclipseAdoptium.Temurin.17.JDK" -ForegroundColor Yellow
                $PrereqOk = $false
            }
        }
    }

    # Check for Gradle wrapper or system Gradle
    $gradlewFile = Join-Path $ScriptDir 'rider' 'gradlew.bat'
    if (-not (Test-Path $gradlewFile)) {
        $gradleCmd = Get-Command gradle -ErrorAction SilentlyContinue
        if (-not $gradleCmd) {
            Write-Host "  WARNING: Gradle wrapper (rider\gradlew.bat) not found and 'gradle' is not on PATH." -ForegroundColor Yellow
            Write-Host "    The wrapper is included in the repository - try a fresh git checkout." -ForegroundColor Yellow
            Write-Host "    Alternatively, install Gradle: https://gradle.org/install/" -ForegroundColor Yellow
            Write-Host "    Or via winget: winget install Gradle.Gradle" -ForegroundColor Yellow
            Write-Host "    Then run: cd rider; gradle wrapper" -ForegroundColor Yellow
            $PrereqOk = $false
        }
        else {
            Write-Host '  OK Gradle wrapper missing, but system Gradle found (will generate wrapper)'
        }
    }
    else {
        Write-Host '  OK Gradle wrapper found: rider\gradlew.bat'
    }
}

Write-Host ''
if (-not $PrereqOk) {
    Write-Host '========================================'
    Write-Host ' Pre-requisite check FAILED'
    Write-Host ' Install the missing tools listed above'
    Write-Host ' and then re-run this script.'
    Write-Host '========================================'
    exit 1
}
Write-Host 'All pre-requisites satisfied.'
Write-Host ''

# --- Clean previous build artefacts from the root directory ---
if ($VSCode) {
    Write-Host "Cleaning previous VS Code packages from $ScriptDir ..."
    Get-ChildItem -Path $ScriptDir -Filter 'ai-skills-manager-*.vsix' -ErrorAction SilentlyContinue |
    Remove-Item -Force
}
if ($Rider) {
    Write-Host "Cleaning previous Rider packages from $ScriptDir ..."
    Get-ChildItem -Path $ScriptDir -Filter 'ai-skills-manager-rider-*.zip' -ErrorAction SilentlyContinue |
    Remove-Item -Force
}

# --- VS Code Extension ---
if ($VSCode) {
    Write-Host ''
    Write-Host '========================================'
    Write-Host ' Building VS Code extension (.vsix)'
    Write-Host '========================================'

    Push-Location (Join-Path $ScriptDir 'vscode')
    try {
        & npm install --silent
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

        & npx @vscode/vsce package
        if ($LASTEXITCODE -ne 0) { throw 'vsce package failed' }

        $vsixFile = Get-ChildItem -Filter '*.vsix' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

        if ($vsixFile) {
            Copy-Item $vsixFile.FullName -Destination $ScriptDir
            Write-Host ''
            Write-Host "OK VS Code package: $($vsixFile.Name) (copied to project root)"
        }
        else {
            Write-Warning 'VSIX file was not produced.'
            $Failed = 1
        }
    }
    catch {
        Write-Warning "VS Code build failed: $_"
        $Failed = 1
    }
    finally {
        Pop-Location
    }
    Write-Host ''
}

# --- Rider / JetBrains Plugin ---
if ($Rider) {
    Write-Host '========================================'
    Write-Host ' Building Rider/JetBrains plugin (.zip)'
    Write-Host '========================================'

    Push-Location (Join-Path $ScriptDir 'rider')
    try {
        $gradlewPath = Join-Path '.' 'gradlew.bat'
        if (-not (Test-Path $gradlewPath)) {
            Write-Host 'Generating Gradle wrapper...'
            & gradle wrapper
            if ($LASTEXITCODE -ne 0) { throw 'gradle wrapper failed' }
        }

        if (Test-Path $gradlewPath) {
            & .\gradlew.bat buildPlugin
            if ($LASTEXITCODE -ne 0) { throw 'gradlew buildPlugin failed' }

            $zipFile = Get-ChildItem -Path 'build\distributions' -Filter '*.zip' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

            if ($zipFile) {
                Copy-Item $zipFile.FullName -Destination $ScriptDir
                Write-Host ''
                Write-Host "OK Rider package: $($zipFile.Name) (copied to project root)"
            }
            else {
                Write-Warning 'Plugin zip was not produced.'
                $Failed = 1
            }
        }
    }
    catch {
        Write-Warning "Rider build failed: $_"
        $Failed = 1
    }
    finally {
        Pop-Location
    }
    Write-Host ''
}

# --- Summary ---
Write-Host '========================================'
if ($Failed -eq 0) {
    Write-Host " All requested packages built successfully."
    Write-Host " Artefacts available in: $ScriptDir\"
}
else {
    Write-Host " Some packages failed to build - see errors above."
}
Write-Host '========================================'

exit $Failed
