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

    where npm >nul 2>&1
    if errorlevel 1 (
        echo ERROR: npm is not installed or not on PATH. 1>&2
        set FAILED=1
    ) else (
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
        where gradle >nul 2>&1
        if errorlevel 1 (
            echo ERROR: Gradle wrapper not found and 'gradle' is not on PATH. 1>&2
            echo Run 'cd rider ^&^& gradle wrapper' to generate it, or install Gradle. 1>&2
            set FAILED=1
            goto :after_rider
        ) else (
            echo Generating Gradle wrapper...
            call gradle wrapper
            if errorlevel 1 ( set FAILED=1& goto :after_rider )
        )
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
