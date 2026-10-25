@echo off
setlocal
cd /d "%~dp0"
title McDonalds Ordering

set "VENV_PY=%~dp0.venv\Scripts\python.exe"
if exist "%VENV_PY%" goto run

echo [setup] .venv not found, creating it. First run only.
set "SYS_PY="
where py >nul 2>nul && set "SYS_PY=py -3"
if not defined SYS_PY where python >nul 2>nul && set "SYS_PY=python"
if not defined SYS_PY goto nopython

%SYS_PY% -c "import sys; sys.exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>nul
if errorlevel 1 goto nopython

%SYS_PY% -m venv "%~dp0.venv"
if errorlevel 1 goto venvfail

:run
"%VENV_PY%" "%~dp0scripts\launcher.py" %*
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" exit /b 0
echo.
echo Stopped with exit code %RC%.
echo If this keeps happening, delete the .venv folder and double-click start.bat again.
pause
exit /b %RC%

:nopython
echo.
echo [error] Python 3.10 or newer was not found.
echo Install it from https://www.python.org/downloads/
echo and tick "Add python.exe to PATH" in the installer, then double-click start.bat again.
pause
exit /b 1

:venvfail
echo.
echo [error] Could not create the .venv folder. Check that this folder is writable.
pause
exit /b 1
