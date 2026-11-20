@echo off
setlocal
cd /d "%~dp0"
if exist "%USERPROFILE%\.bun\bin\bun.exe" (
  "%USERPROFILE%\.bun\bin\bun.exe" Control.ts %*
) else (
  bun Control.ts %*
)
