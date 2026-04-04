@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
:: Remove trailing backslash
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set BUILD_VSCODE=0
set BUILD_RIDER=0

:: Parse arguments
:parse_args
if "%~1"=="" goto :done_args
if /i "%~1"=="--vscode" ( set BUILD_VSCODE=1& shift & goto :parse_args )
if /i "%~1"=="--rider"  ( set BUILD_RIDER=1&  shift & goto :parse_args )
if /i "%~1"=="-h"       goto :show_help
if /i "%~1"=="--help"   goto :show_help
echo Unknown option: %~1 1>&2
echo Run '%~nx0 --help' for usage. 1>&2
exit /b 1

:show_help
echo Usage: %~nx0 [--vscode] [--rider]
echo.
echo Package IDE extensions for distribution.
echo.
echo Options:
echo   --vscode    Build the VS Code extension (.vsix)
echo   --rider     Build the Rider/JetBrains plugin (.zip)
echo.
echo If no options are specified, both packages are built.
exit /b 0

:done_args

:: Default: build both if neither flag was provided
if %BUILD_VSCODE%==0 if %BUILD_RIDER%==0 (
    set BUILD_VSCODE=1
    set BUILD_RIDER=1
)

set FAILED=0
set PREREQ_OK=1

:: ========================================
::  Pre-requisite checks
:: ========================================
echo ========================================
echo  Checking pre-requisites
echo ========================================

if %BUILD_VSCODE%==1 (
    echo.
    echo VS Code extension requires: Node.js (npm^), Git
    call :check_cmd node  "Node.js"
    call :check_cmd npm   "npm"
    call :check_cmd git   "Git"
)

if %BUILD_RIDER%==1 (
    echo.
    echo Rider plugin requires: JDK 17+
    call :check_cmd java  "Java"
    call :check_cmd javac "javac"

    :: Verify Java version >= 17
    where java >nul 2>&1
    if not errorlevel 1 (
        for /f "tokens=3 delims=. " %%v in ('java -version 2^>^&1 ^| findstr /i "version"') do (
            set "JAVA_VER_RAW=%%~v"
        )
        :: Strip surrounding quotes
        set "JAVA_VER_RAW=!JAVA_VER_RAW:"=!"
        :: Extract major version (handle both "17.0.x" and "1.8.x" formats)
        for /f "tokens=1 delims=." %%m in ("!JAVA_VER_RAW!") do set "JAVA_MAJOR=%%m"
        if !JAVA_MAJOR! LSS 17 (
            echo   WARNING: Java version !JAVA_VER_RAW! detected -- JDK 17 or later is required.
            echo     Download JDK 17+: https://adoptium.net/
            echo     Or install via winget: winget install EclipseAdoptium.Temurin.17.JDK
            set PREREQ_OK=0
        )
    )

    :: Check for Gradle wrapper or system Gradle
    if not exist "%SCRIPT_DIR%\rider\gradlew.bat" (
        where gradle >nul 2>&1
        if errorlevel 1 (
            echo   WARNING: Gradle wrapper (rider\gradlew.bat^) not found and 'gradle' is not on PATH.
            echo     The wrapper is included in the repository -- try a fresh git checkout.
            echo     Alternatively, install Gradle: https://gradle.org/install/
            echo     Or via winget: winget install Gradle.Gradle
            echo     Then run: cd rider ^&^& gradle wrapper
            set PREREQ_OK=0
        ) else (
            echo   OK Gradle wrapper missing, but system Gradle found (will generate wrapper^)
        )
    ) else (
        echo   OK Gradle wrapper found: rider\gradlew.bat
    )
)

echo.
if %PREREQ_OK%==0 (
    echo ========================================
    echo  Pre-requisite check FAILED
    echo  Install the missing tools listed above
    echo  and then re-run this script.
    echo ========================================
    exit /b 1
)
echo All pre-requisites satisfied.
echo.

:: --- Clean previous build artefacts from the root directory ---
if %BUILD_VSCODE%==1 (
    echo Cleaning previous VS Code packages from %SCRIPT_DIR% ...
    del /q "%SCRIPT_DIR%\ai-skills-manager-*.vsix" 2>nul
)
if %BUILD_RIDER%==1 (
    echo Cleaning previous Rider packages from %SCRIPT_DIR% ...
    del /q "%SCRIPT_DIR%\ai-skills-manager-rider-*.zip" 2>nul
)

:: --- VS Code Extension ---
if %BUILD_VSCODE%==1 (
    echo ========================================
    echo  Building VS Code extension (.vsix^)
    echo ========================================
    cd /d "%SCRIPT_DIR%\vscode"

    call npm install --silent
    if errorlevel 1 ( set FAILED=1& goto :after_vscode )
    call npx @vscode/vsce package
    if errorlevel 1 ( set FAILED=1& goto :after_vscode )

    set "VSIX_FILE="
    for %%f in (*.vsix) do set "VSIX_FILE=%%f"
    if defined VSIX_FILE (
        copy "!VSIX_FILE!" "%SCRIPT_DIR%\" >nul
        echo.
        echo VS Code package: !VSIX_FILE! (copied to project root^)
    ) else (
        echo ERROR: VSIX file was not produced. 1>&2
        set FAILED=1
    )
    :after_vscode
    echo.
)

:: --- Rider / JetBrains Plugin ---
if %BUILD_RIDER%==1 (
    echo ========================================
    echo  Building Rider/JetBrains plugin (.zip^)
    echo ========================================
    cd /d "%SCRIPT_DIR%\rider"

    if not exist "gradlew.bat" (
        echo Generating Gradle wrapper...
        call gradle wrapper
        if errorlevel 1 ( set FAILED=1& goto :after_rider )
    )

    if exist "gradlew.bat" (
        call gradlew.bat buildPlugin
        if errorlevel 1 ( set FAILED=1& goto :after_rider )

        set "ZIP_FILE="
        for %%f in (build\distributions\*.zip) do set "ZIP_FILE=%%f"
        if defined ZIP_FILE (
            copy "!ZIP_FILE!" "%SCRIPT_DIR%\" >nul
            for %%b in ("!ZIP_FILE!") do set "BASENAME=%%~nxb"
            echo.
            echo Rider package: !BASENAME! (copied to project root^)
        ) else (
            echo ERROR: Plugin zip was not produced. 1>&2
            set FAILED=1
        )
    )
    :after_rider
    echo.
)

:: --- Summary ---
echo ========================================
if %FAILED%==0 (
    echo  All requested packages built successfully.
    echo  Artefacts available in: %SCRIPT_DIR%\
) else (
    echo  Some packages failed to build — see errors above.
)
echo ========================================

exit /b %FAILED%

:: ========================================
::  Subroutine — check whether a command exists
:: ========================================
:check_cmd
:: %~1 = command name, %~2 = display label
where %~1 >nul 2>&1
if errorlevel 1 (
    echo   MISSING: %~2 is NOT installed or not on PATH.
    if /i "%~1"=="node" (
        echo     Download Node.js 22.x LTS: https://nodejs.org/
        echo     Or install via winget:     winget install OpenJS.NodeJS.LTS
    )
    if /i "%~1"=="npm" (
        echo     npm is included with Node.js — install Node.js to get it.
        echo     Download Node.js 22.x LTS: https://nodejs.org/
    )
    if /i "%~1"=="git" (
        echo     Download Git: https://git-scm.com/download/win
        echo     Or install via winget: winget install Git.Git
    )
    if /i "%~1"=="java" (
        echo     Download JDK 17+: https://adoptium.net/
        echo     Or install via winget: winget install EclipseAdoptium.Temurin.17.JDK
    )
    if /i "%~1"=="javac" (
        echo     javac is included with the JDK — install a full JDK (not just JRE^).
        echo     Download JDK 17+: https://adoptium.net/
    )
    set PREREQ_OK=0
) else (
    for /f "tokens=*" %%v in ('%~1 --version 2^>^&1') do (
        echo   OK %~2 found: %%v
        goto :check_cmd_done
    )
)
:check_cmd_done
exit /b 0
