@echo off
setlocal
node "%~dp0install.mjs" %*
exit /b %errorlevel%
