@echo off
setlocal
cd /d "%~dp0"
py -3 -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>&1
if not errorlevel 1 (
    py -3 "%~dp0open_graph.py"
    goto end
)
python -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>&1
if not errorlevel 1 (
    python "%~dp0open_graph.py"
    goto end
)
echo Python 3.8 or newer is required.
echo Install Python from https://www.python.org/downloads/ and try again.
pause
exit /b 1
:end
if errorlevel 1 pause
endlocal
