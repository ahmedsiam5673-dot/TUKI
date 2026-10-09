@echo off
rem Double-click this file. First run installs what is missing, builds Tuki and starts it.
rem Later runs just start Tuki.
title Tuki
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Tuki.ps1"
if errorlevel 1 pause
