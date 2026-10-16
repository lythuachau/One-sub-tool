@echo off
setlocal EnableExtensions DisableDelayedExpansion
title One-sub-tool

pushd "%~dp0"
if errorlevel 1 exit /b 1

where node >nul 2>&1
if errorlevel 1 (
    set "RUN_ERROR=Chua tim thay Node.js. Hay cai Node.js LTS va mo lai file nay."
    goto failed
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
    set "RUN_ERROR=Chua tim thay npm. Hay cai lai Node.js LTS va mo lai file nay."
    goto failed
)

call :validate_project
if not errorlevel 1 goto project_ready
if not exist "%~dp0One-sub-tool\package.json" goto missing_project
cd /d "%~dp0One-sub-tool"
if errorlevel 1 goto missing_project
call :validate_project
if errorlevel 1 goto missing_project

:project_ready
node -e "for (const name of ['cross-env', 'concurrently', 'react-scripts']) require.resolve(name + '/package.json');"
if errorlevel 1 (
    set "RUN_ERROR=Thieu dependencies. Chay OSG_installer_Windows.bat va chon 1 de cai day du."
    goto failed
)
if not exist ".venv\Scripts\python.exe" (
    set "RUN_ERROR=Thieu moi truong Python. Chay OSG_installer_Windows.bat va chon 1 truoc."
    goto failed
)

node -e "const p = require('./package.json'); console.log('One-sub-tool v' + p.version); console.log('Thu muc: ' + process.cwd());"
if /i "%~1"=="/check" (
    echo [OK] San sang khoi dong.
    popd
    exit /b 0
)

echo Dang khoi dong giao dien, backend va he thong TTS...
echo Nhan Ctrl+C de dung tool.
call npm.cmd run dev:cuda
set "RUN_EXIT_CODE=%errorlevel%"
if not "%RUN_EXIT_CODE%"=="0" (
    echo [LOI] Tool da dung voi ma loi %RUN_EXIT_CODE%.
    pause
)
popd
exit /b %RUN_EXIT_CODE%

:missing_project
set "RUN_ERROR=Chua tim thay One-sub-tool v3. Dat run.bat canh package.json hoac thu muc One-sub-tool da cai."

:failed
echo [LOI] %RUN_ERROR%
popd
if /i not "%~1"=="/check" pause
exit /b 1

:validate_project
node -e "const fs = require('fs'); const p = require('./package.json'); if (p.name !== 'one-sub-tool' || !(Number(p.version.split('.')[0]) >= 3) || !p.scripts || !p.scripts['dev:cuda'] || !p.scripts['setup:tts'] || !fs.existsSync('scripts/start-all.js')) process.exit(1);" 2>nul
exit /b %errorlevel%
