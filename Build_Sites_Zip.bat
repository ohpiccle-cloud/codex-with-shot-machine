@echo off
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo Install Node.js 24 LTS and reopen this file.
    goto failed
)
if not defined GPT_SITES_PROJECT_ID set /p "GPT_SITES_PROJECT_ID=GPT Sites project ID: "
if not defined GPT_SITES_PROJECT_ID goto failed
call npm --prefix sites ci
if errorlevel 1 goto failed
call npm --prefix sites run build
if errorlevel 1 goto failed
py -3 --version >nul 2>&1
if errorlevel 1 (
    python sites\scripts\package_zip.py
) else (
    py -3 sites\scripts\package_zip.py
)
if errorlevel 1 goto failed
echo ZIP ready in the sites folder.
explorer "%~dp0sites"
pause
exit /b 0
:failed
echo Could not create the ZIP. Check the message above.
pause
exit /b 1
