@ECHO OFF
CLS

:: --- Configuration ---
SET "PROJECT_FOLDER_NAME=oneclick-subtitles-generator"
SET "GIT_REPO_URL=https://github.com/nganlinh4/oneclick-subtitles-generator.git"
SET "SCRIPT_DIR=%~dp0"
SET "PROJECT_PATH=%SCRIPT_DIR%%PROJECT_FOLDER_NAME%"
IF "%PROJECT_PATH:~-1%"=="\" SET "PROJECT_PATH=%PROJECT_PATH:~0,-1%"

:: --- Fixed Settings (Vietnamese Menu) ---
SET "MENU_LABEL=MainMenuVI"
SET "PROMPT_CHOICE=Nhap lua chon cua ban (1-7): "
SET "TITLE_TEXT=Quan Ly Trinh Tao Phu De OneClick"

TITLE %TITLE_TEXT%

:: --- Check for Administrator Privileges ---
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[?] Checking administrator privileges...' -ForegroundColor Yellow; if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] 'Administrator')) { Write-Host ''; Write-Host '======================================================'; Write-Host '[ERROR] Administrator privileges required.' -ForegroundColor Red; Write-Host '[INFO] Requesting administrator privileges...' -ForegroundColor Blue; Write-Host '======================================================'; Start-Process '%~f0' -Verb RunAs; exit 1 } else { Write-Host '[OK] Administrator privileges confirmed.' -ForegroundColor Green; Write-Host '' }"
IF %ERRORLEVEL% NEQ 0 EXIT /B

GOTO %MENU_LABEL%

:: =============================================================================
:: VIETNAMESE MENU (Hardcoded)
:: =============================================================================
:MainMenuVI
CLS
ECHO.
:: Display the new Unicode ASCII logo with smooth blue gradient (left-to-right diagonal)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host ('     ' + [char]27 + '[38;2;230;255;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2557 + [char]27 + '[38;2;210;245;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;190;235;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2557 + [char]27 + '[38;2;170;225;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;150;215;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2557 + [char]27 + '[0m'); Write-Host ('  ' + [char]27 + '[38;2;220;250;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2557 + [char]27 + '[38;2;195;240;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;175;230;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2557 + [char]27 + '[38;2;155;220;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;135;210;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2557 + [char]27 + '[0m'); Write-Host (' ' + [char]27 + '[38;2;210;245;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2557 + [char]27 + '[38;2;185;235;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;165;225;255m' + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x255D + [char]27 + '[38;2;145;215;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;125;205;255m' + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x255D + [char]27 + '[38;2;105;195;255m' + [char]0x2591 + [char]27 + '[0m'); Write-Host ([char]27 + '[38;2;200;240;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x255D + [char]27 + '[38;2;180;230;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;160;220;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2557 + [char]27 + '[38;2;140;210;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;120;200;255m' + [char]0x2588 + [char]0x2588 + [char]0x2557 + [char]27 + '[38;2;100;190;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;80;180;255m' + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;60;170;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[0m'); Write-Host ([char]27 + '[38;2;190;235;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;170;225;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;150;215;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;130;205;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;110;195;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2557 + [char]27 + '[38;2;90;185;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;70;175;255m' + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;50;165;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;30;155;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2557 + [char]27 + '[0m'); Write-Host ([char]27 + '[38;2;180;230;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;160;220;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;140;210;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;120;200;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;100;190;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;80;180;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;60;170;255m' + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;40;160;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;20;150;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[0m'); Write-Host ([char]27 + '[38;2;170;225;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;150;215;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;130;205;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;110;195;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;90;185;255m' + [char]0x255A + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;70;175;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;50;165;255m' + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;30;155;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;10;145;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[0m '); Write-Host (' ' + [char]27 + '[38;2;160;220;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;140;210;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;120;200;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x255D + [char]27 + '[38;2;100;190;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;80;180;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x255D + [char]27 + '[38;2;60;170;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;40;160;255m' + [char]0x2588 + [char]0x2588 + [char]0x2551 + [char]27 + '[38;2;20;150;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;0;140;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x255D + [char]27 + '[0m'); Write-Host (' ' + [char]27 + '[38;2;150;215;255m' + [char]0x255A + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x255D + [char]27 + '[38;2;130;205;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;110;195;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x255D + [char]27 + '[38;2;90;185;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;70;175;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x2550 + [char]0x255D + [char]27 + '[0m'); Write-Host ('    ' + [char]27 + '[38;2;140;210;255m' + [char]0x255A + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x2550 + [char]0x2550 + [char]0x255D + [char]27 + '[38;2;120;200;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;100;190;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x2550 + [char]0x2550 + [char]0x255D + [char]27 + '[38;2;80;180;255m' + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;60;170;255m' + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2588 + [char]0x2554 + [char]0x2550 + [char]0x2550 + [char]0x255D + [char]27 + '[0m'); Write-Host ('      ' + [char]27 + '[38;2;130;205;255m' + [char]0x255A + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x255D + [char]27 + '[38;2;110;195;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;90;185;255m' + [char]0x255A + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x255D + [char]27 + '[38;2;70;175;255m' + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]0x2591 + [char]27 + '[38;2;50;165;255m' + [char]0x255A + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x2550 + [char]0x255D + [char]27 + '[0m')"
ECHO.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '======================================================' -ForegroundColor Cyan; Write-Host '%TITLE_TEXT%' -ForegroundColor White -BackgroundColor DarkBlue; Write-Host 'Vi tri (Location): %SCRIPT_DIR%' -ForegroundColor Gray; Write-Host 'Thu muc Du an (Project Folder): %PROJECT_FOLDER_NAME%' -ForegroundColor Gray; Write-Host '======================================================' -ForegroundColor Cyan; Write-Host 'Vui long chon mot tuy chon:' -ForegroundColor Yellow"
ECHO.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host 'CAI DAT / THIET LAP:' -ForegroundColor Green -BackgroundColor Black; Write-Host '  1. Cai dat (Thuyet minh thong thuong + Long tieng nhan ban giong noi)' -ForegroundColor White; Write-Host '     (Install with Gemini + VieNeu-TTS + OmniVoice Narration)' -ForegroundColor Cyan; Write-Host '     (Luu y: Se ton nhieu dung luong luu tru hon, tren Windows chi ho tro GPU cua NVIDIA va Intel)' -ForegroundColor Yellow; Write-Host '  2. Cai dat (Thuyet minh thong thuong) (Install with Gemini Narration)' -ForegroundColor White"
ECHO.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host 'BAO TRI / SU DUNG:' -ForegroundColor Blue -BackgroundColor Black; Write-Host '  3. Cap nhat Ung dung (Update)' -ForegroundColor White; Write-Host '  4. Chay Ung dung (Run App)' -ForegroundColor White; Write-Host '  5. Chay Ung dung voi Nhan ban giong noi (Run App with VieNeu-TTS + OmniVoice Narration)' -ForegroundColor White"
ECHO.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host 'GO CAI DAT:' -ForegroundColor Red -BackgroundColor Black; Write-Host '  6. Go cai dat Ung dung (Uninstall)' -ForegroundColor White"
ECHO.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '  7. Thoat (Exit)' -ForegroundColor Gray; Write-Host '======================================================' -ForegroundColor Cyan"
ECHO.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '%PROMPT_CHOICE%' -ForegroundColor Yellow -NoNewline"
SET /P "CHOICE="

:: Validate input
IF NOT "%CHOICE%"=="" SET CHOICE=%CHOICE:~0,1%
IF "%CHOICE%"=="1" GOTO InstallNarration
IF "%CHOICE%"=="2" GOTO InstallNoNarration
IF "%CHOICE%"=="3" GOTO UpdateApp
IF "%CHOICE%"=="4" GOTO RunApp
IF "%CHOICE%"=="5" GOTO RunAppCUDA
IF "%CHOICE%"=="6" GOTO UninstallApp
IF "%CHOICE%"=="7" GOTO ExitScript

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[ERROR] Lua chon khong hop le. Vui long thu lai.' -ForegroundColor Red"
TIMEOUT /T 2 /NOBREAK > NUL
GOTO %MENU_LABEL%

REM ==============================================================================
:InstallNarration
ECHO.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '======================================================' -ForegroundColor Cyan"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[SETUP] Option 1: Full Installation with Voice Cloning (Preview Branch)' -ForegroundColor White -BackgroundColor DarkGreen"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '======================================================' -ForegroundColor Cyan"
ECHO.

CALL :InstallPrerequisites
IF %ERRORLEVEL% NEQ 0 GOTO ErrorOccurred

CALL :CleanInstall "%PROJECT_PATH%"
IF %ERRORLEVEL% NEQ 0 GOTO ErrorOccurred

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[SETUP] Downloading application (preview branch)...' -ForegroundColor Cyan"
git clone -b preview %GIT_REPO_URL% "%PROJECT_PATH%" >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[ERROR] Failed to download application.' -ForegroundColor Red"
    GOTO ErrorOccurred
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] Application downloaded successfully.' -ForegroundColor Green"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[SETUP] Changing to project directory...' -ForegroundColor Cyan"
PUSHD "%PROJECT_PATH%"
IF %ERRORLEVEL% NEQ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[ERROR] Failed to access project folder.' -ForegroundColor Red"
    POPD
    GOTO ErrorOccurred
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[SETUP] Installing all dependencies (this may take several minutes)...' -ForegroundColor Cyan"
CALL npm run install:all
IF %ERRORLEVEL% NEQ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[ERROR] Failed to install dependencies. Check messages above.' -ForegroundColor Red"
    POPD
    GOTO ErrorOccurred
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[SETUP] Finalizing installation...' -ForegroundColor Cyan"
CALL npm run install:yt-dlp >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[WARN] YouTube downloader installation had issues.' -ForegroundColor Yellow"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[INFO] You can fix this later with ''npm run install:yt-dlp''.' -ForegroundColor Blue"
)

ECHO.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] Installation completed successfully!' -ForegroundColor Green"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[START] Launching application with voice cloning features...' -ForegroundColor Magenta"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[INFO] Press Ctrl+C to stop the application.' -ForegroundColor Blue"
ECHO.
CALL npm run dev:cuda
POPD
GOTO %MENU_LABEL%

REM ==============================================================================
:InstallNoNarration
ECHO.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '======================================================' -ForegroundColor Cyan"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[SETUP] Option 2: Standard Installation (Preview Branch)' -ForegroundColor White -BackgroundColor DarkBlue"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '======================================================' -ForegroundColor Cyan"
ECHO.

CALL :InstallPrerequisites
IF %ERRORLEVEL% NEQ 0 GOTO ErrorOccurred

CALL :CleanInstall "%PROJECT_PATH%"
IF %ERRORLEVEL% NEQ 0 GOTO ErrorOccurred

ECHO [SETUP] Downloading application (preview branch)...
git clone -b preview %GIT_REPO_URL% "%PROJECT_PATH%" >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    ECHO [ERROR] Failed to download application.
    GOTO ErrorOccurred
)
ECHO [OK] Application downloaded successfully.

ECHO [SETUP] Changing to project directory...
PUSHD "%PROJECT_PATH%"
IF %ERRORLEVEL% NEQ 0 (
    ECHO [ERROR] Failed to access project folder.
    POPD
    GOTO ErrorOccurred
)

ECHO [SETUP] Installing dependencies...
CALL npm install
IF %ERRORLEVEL% NEQ 0 (
    ECHO [ERROR] Failed to install dependencies. Check messages above.
    POPD
    GOTO ErrorOccurred
)

ECHO [SETUP] Finalizing installation...
CALL npm run install:yt-dlp >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    ECHO [WARN] YouTube downloader installation had issues.
    ECHO [INFO] You can fix this later with 'npm run install:yt-dlp'.
)

ECHO.
ECHO [OK] Installation completed successfully!
ECHO [START] Launching application...
ECHO [INFO] Press Ctrl+C to stop the application.
ECHO.
CALL npm run dev
POPD
GOTO %MENU_LABEL%

REM ==============================================================================
:UpdateApp
ECHO *** Tuy chon 3: Cap nhat Ung dung (Option 3: Update) ***
IF NOT EXIST "%PROJECT_PATH%\.git" (
    ECHO LOI: Thu muc du an "%PROJECT_PATH%" khong tim thay hoac khong phai la kho git.
    ECHO Vui long su dung mot trong cac tuy chon Cai dat truoc.
    GOTO ErrorOccurred
)

ECHO Changing directory to "%PROJECT_PATH%"
PUSHD "%PROJECT_PATH%"
IF %ERRORLEVEL% NEQ 0 (
    ECHO ERROR: Failed to change directory to project folder.
    POPD
    GOTO ErrorOccurred
)

ECHO Pulling latest changes from repository...
git reset --hard origin/main
git pull
uv pip install --python .venv --upgrade yt-dlp
IF %ERRORLEVEL% NEQ 0 (
    ECHO ERROR: Failed to pull updates using 'git pull' or 'uv pip install --python .venv --upgrade yt-dlp'. Check messages above.
    POPD
    GOTO ErrorOccurred
)
ECHO Kiem tra cap nhat hoan tat.
POPD

ECHO.
SET /P "INSTALL_DEPS=Chay 'npm install' ngay bay gio trong truong hop cac phu thuoc da thay doi? (c/k): "
IF /I "%INSTALL_DEPS%"=="c" (
    ECHO Changing directory to "%PROJECT_PATH%"
    PUSHD "%PROJECT_PATH%"
    IF %ERRORLEVEL% NEQ 0 (
        ECHO ERROR: Failed to change directory to project folder for npm install.
        GOTO ErrorOccurred
    )
    ECHO Running 'npm install'...
    CALL npm install
     IF %ERRORLEVEL% NEQ 0 (
        ECHO WARNING: 'npm install' encountered errors. Check messages above.
    ) ELSE (
        ECHO 'npm install' completed.
    )
	PAUSE
    POPD
)

GOTO %MENU_LABEL%

REM ==============================================================================
:RunApp
ECHO *** Tuy chon 4: Chay Ung dung (Option 4: Run App) ***
IF NOT EXIST "%PROJECT_PATH%\package.json" (
    ECHO LOI: Thu muc du an "%PROJECT_PATH%" hoac package.json khong tim thay.
    ECHO Vui long su dung mot trong cac tuy chon Cai dat truoc.
    GOTO ErrorOccurred
)

ECHO Changing directory to "%PROJECT_PATH%"
PUSHD "%PROJECT_PATH%"
IF %ERRORLEVEL% NEQ 0 (
    ECHO ERROR: Failed to change directory to project folder.
    POPD
    GOTO ErrorOccurred
)

ECHO Dang khoi chay ung dung (using npm run dev)...
ECHO Nhan Ctrl+C trong cua so nay de dung ung dung sau.
CALL npm run dev
IF %ERRORLEVEL% NEQ 0 (
    ECHO ERROR: Failed to start application using 'npm run dev'. Check messages above.
    POPD
    GOTO ErrorOccurred
)
POPD
GOTO %MENU_LABEL%

REM ==============================================================================
:RunAppCUDA
ECHO *** Tuy chon 5: Chay Ung dung voi Nhan ban giong noi (Option 5: Run App with VieNeu-TTS + OmniVoice Narration) ***
IF NOT EXIST "%PROJECT_PATH%\package.json" (
    ECHO LOI: Thu muc du an "%PROJECT_PATH%" hoac package.json khong tim thay.
    ECHO Vui long su dung mot trong cac tuy chon Cai dat truoc.
    GOTO ErrorOccurred
)

ECHO Changing directory to "%PROJECT_PATH%"
PUSHD "%PROJECT_PATH%"
IF %ERRORLEVEL% NEQ 0 (
    ECHO ERROR: Failed to change directory to project folder.
    POPD
    GOTO ErrorOccurred
)

ECHO Dang khoi chay ung dung voi CUDA (using npm run dev:cuda)...
ECHO Luu y: Yeu cau GPU NVIDIA tuong thich va CUDA Toolkit da duoc cai dat.
ECHO Nhan Ctrl+C trong cua so nay de dung ung dung sau.
CALL npm run dev:cuda
IF %ERRORLEVEL% NEQ 0 (
    ECHO ERROR: Failed to start application using 'npm run dev:cuda'. Check messages above.
    POPD
    GOTO ErrorOccurred
)
POPD
GOTO %MENU_LABEL%

REM ==============================================================================
:UninstallApp
ECHO *** Tuy chon 6: Go cai dat Ung dung (Option 6: Uninstall) ***
IF NOT EXIST "%PROJECT_PATH%" (
    ECHO THONG TIN: Thu muc du an "%PROJECT_PATH%" khong tim thay. Ung dung co the chua duoc cai dat.
    GOTO ErrorOccurred
)

ECHO CANH BAO: Hanh dong nay se xoa vinh vien thu muc du an va tat ca noi dung cua no:
ECHO %PROJECT_PATH%
ECHO.
SET /P "CONFIRM_UNINSTALL=Ban co chac chan muon tiep tuc go cai dat? (c/k): "
IF /I NOT "%CONFIRM_UNINSTALL%"=="c" (
    ECHO Da huy go cai dat.
    GOTO %MENU_LABEL%
)

ECHO Dang xoa thu muc du an: %PROJECT_PATH%...
RMDIR /S /Q "%PROJECT_PATH%"
IF %ERRORLEVEL% NEQ 0 (
    ECHO LOI: Khong the xoa thu muc du an. Kiem tra quyen hoac tap tin co dang duoc su dung khong.
    GOTO ErrorOccurred
)

ECHO Go cai dat hoan tat. Thu muc du an da duoc xoa.
GOTO %MENU_LABEL%

REM ==============================================================================
:: Subroutine: Install Prerequisites (Choco, Git, Node, FFmpeg, uv)
:InstallPrerequisites
ECHO.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '--- Checking System Requirements ---' -ForegroundColor White -BackgroundColor DarkMagenta"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[SETUP] Configuring PowerShell security settings...' -ForegroundColor Cyan"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072;" > nul
IF %ERRORLEVEL% NEQ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[ERROR] Failed to configure PowerShell security.' -ForegroundColor Red"
    EXIT /B 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[?] Checking for Chocolatey package manager...' -ForegroundColor Yellow"
WHERE choco >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[SETUP] Installing Chocolatey package manager...' -ForegroundColor Cyan"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))" >nul 2>&1
    IF %ERRORLEVEL% NEQ 0 (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[ERROR] Failed to install Chocolatey.' -ForegroundColor Red"
        EXIT /B 1
    )
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[INFO] Waiting for Chocolatey to initialize...' -ForegroundColor Blue"
    timeout /t 5 /nobreak > nul
    WHERE choco >nul 2>nul
    IF %ERRORLEVEL% NEQ 0 (
       powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[ERROR] Chocolatey installation failed.' -ForegroundColor Red"
       EXIT /B 1
   )
   powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] Chocolatey installed successfully.' -ForegroundColor Green"
) ELSE (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] Chocolatey already installed.' -ForegroundColor Green"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[?] Checking for Git...' -ForegroundColor Yellow"
WHERE git >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    ECHO [SETUP] Installing Git version control...
    winget install --id Git.Git -e --source winget >nul 2>&1
    IF %ERRORLEVEL% NEQ 0 (
        ECHO [INFO] Trying alternative installation method...
        choco install git -y >nul 2>&1
        IF %ERRORLEVEL% NEQ 0 (
            ECHO [ERROR] Failed to install Git.
            EXIT /B 1
        )
    )
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] Git installed successfully.' -ForegroundColor Green"
    REFRESHENV
) ELSE (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] Git already installed.' -ForegroundColor Green"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[?] Checking for Node.js...' -ForegroundColor Yellow"
WHERE node >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    ECHO [SETUP] Installing Node.js runtime...
    winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements -s winget >nul 2>&1
     IF %ERRORLEVEL% NEQ 0 (
      ECHO [INFO] Trying alternative installation method...
      choco install nodejs-lts -y >nul 2>&1
      IF %ERRORLEVEL% NEQ 0 (
          ECHO [ERROR] Failed to install Node.js.
          EXIT /B 1
      )
    )
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] Node.js installed successfully.' -ForegroundColor Green"
    REFRESHENV
) ELSE (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] Node.js already installed.' -ForegroundColor Green"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[?] Checking for FFmpeg...' -ForegroundColor Yellow"
WHERE ffmpeg >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    ECHO [SETUP] Installing FFmpeg media processor...
    choco install ffmpeg -y >nul 2>&1
    IF %ERRORLEVEL% NEQ 0 (
      ECHO [WARN] Failed to install FFmpeg. Some features may not work.
    ) ELSE (
      powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] FFmpeg installed successfully.' -ForegroundColor Green"
    )
    REFRESHENV
) ELSE (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] FFmpeg already installed.' -ForegroundColor Green"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[?] Checking for uv Python package manager...' -ForegroundColor Yellow"
WHERE uv >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    ECHO [SETUP] Installing uv Python package manager...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex" >nul 2>&1
    IF %ERRORLEVEL% NEQ 0 (
        ECHO [ERROR] Failed to install uv package manager.
        ECHO [INFO] You may need to install it manually from https://astral.sh/uv
        EXIT /B 1
    )
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] uv installed successfully.' -ForegroundColor Green"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[INFO] You may need to restart this script if uv is not found.' -ForegroundColor Blue"
) ELSE (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] uv already installed.' -ForegroundColor Green"
)
:: *********************************

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[SETUP] Finalizing PowerShell configuration...' -ForegroundColor Cyan"
powershell -NoProfile -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force" > nul

ECHO.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] System requirements check completed.' -ForegroundColor Green"
ECHO.
EXIT /B 0
:: End of InstallPrerequisites Subroutine

REM ==============================================================================
:: Subroutine: Clean Install - Removes existing project folder (Modified: No Confirmation)
:CleanInstall
SET "FOLDER_TO_CLEAN=%~1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[?] Checking for existing installation: %FOLDER_TO_CLEAN%' -ForegroundColor Yellow"
IF EXIST "%FOLDER_TO_CLEAN%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[WARN] Found existing installation. Removing for clean install...' -ForegroundColor Yellow"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[SETUP] Removing existing project folder...' -ForegroundColor Cyan"
    RMDIR /S /Q "%FOLDER_TO_CLEAN%" >nul 2>&1
    IF %ERRORLEVEL% NEQ 0 (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[ERROR] Cannot remove existing folder \"%FOLDER_TO_CLEAN%\".' -ForegroundColor Red"
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[INFO] Please close any programs using this folder and try again.' -ForegroundColor Blue"
        EXIT /B 1
    )
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] Existing installation removed successfully.' -ForegroundColor Green"
) ELSE (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '[OK] No existing installation found. Proceeding with fresh install.' -ForegroundColor Green"
)
EXIT /B 0
:: End of CleanInstall Subroutine

REM ==============================================================================
:ErrorOccurred
ECHO.
ECHO ======================================================
ECHO [ERROR] Installation failed!
ECHO ======================================================
ECHO [INFO] Common solutions:
ECHO   - Close this window and run the installer again
ECHO   - Restart your computer and try again
ECHO   - Check your internet connection
ECHO   - Run as administrator
ECHO.
ECHO [INFO] System PATH may need to be refreshed for new tools.
ECHO ======================================================
ECHO.
PAUSE
GOTO %MENU_LABEL%

:ExitScript
EXIT /B 0
