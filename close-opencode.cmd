@echo off
title Close OpenCode
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0close-opencode.ps1" %*
set "status=%ERRORLEVEL%"
echo.
pause
exit /b %status%
