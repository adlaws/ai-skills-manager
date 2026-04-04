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
        $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
        if (-not $npmCmd) {
            Write-Error 'npm is not installed or not on PATH.'
            $Failed = 1
        }
        else {
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
            $gradleCmd = Get-Command gradle -ErrorAction SilentlyContinue
            if (-not $gradleCmd) {
                Write-Error "Gradle wrapper not found and 'gradle' is not on PATH. Run 'cd rider && gradle wrapper' to generate it, or install Gradle."
                $Failed = 1
                throw 'No Gradle available'
            }
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
