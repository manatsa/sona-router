@echo off
title Claude Code (Local LLM)

:: Set the base URL to point to sona-router (Claude Code uses ANTHROPIC_BASE_URL, not ANTHROPIC_API_URL)
set ANTHROPIC_BASE_URL=http://localhost:9001

:: Start sona-router in a minimized window
start /min "Sona Router" cmd /k "cd /d %~dp0 && node dist/index.js start"

:: Wait for the server to start
echo Starting sona-router (minimized)...
timeout /t 3 /nobreak >nul

:: Start Claude Code in the foreground
echo Starting Claude Code with local LLM...
echo.
claude

:: When Claude exits, offer to close the router
echo.
echo Claude Code has exited.
echo.
set /p choice="Close Sona Router? (Y/N): "
if /i "%choice%"=="Y" (
    taskkill /fi "WINDOWTITLE eq Sona Router" >nul 2>&1
    echo Sona Router closed.
)
pause
