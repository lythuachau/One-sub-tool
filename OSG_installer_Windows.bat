@echo off
setlocal
set "ONE_SUB_INSTALLER=%~f0"
set "ONE_SUB_INSTALLER_ACTION=%~1"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$text=[IO.File]::ReadAllText($env:ONE_SUB_INSTALLER); $marker='# ONE_SUB_POWERSHELL'; & ([scriptblock]::Create($text.Substring($text.LastIndexOf($marker)+$marker.Length)))"
set "INSTALLER_EXIT=%ERRORLEVEL%"
if not "%INSTALLER_EXIT%"=="0" if "%~1"=="" pause
exit /b %INSTALLER_EXIT%
# ONE_SUB_POWERSHELL
$ErrorActionPreference = 'Stop'
$repository = 'https://github.com/lythuachau/One-sub-tool.git'
$installerVersion = '3.0.0-alpha.13'
$installBranch = "release/v$installerVersion"
$installerDirectory = Split-Path -Parent $env:ONE_SUB_INSTALLER
$requiredProjectFiles = @(
    'server\engines\asrCatalog.js',
    'server\routes\engineRoutes.js',
    'server\routes\asrUploadRoutes.js',
    'server\tts_service\omnivoice_service.py',
    'src\services\chatterboxService.js',
    'src\components\narration\components\NarrationInputSource.js',
    'asr_services\faster_whisper\app.py',
    'asr_services\qwen3_asr\app.py',
    'parakeet_wrapper\app.py',
    'server\controllers\narration\audioFile\audioArtifactSafety.js',
    'src\components\VideoAnalysisButton.js',
    'src\components\narration\components\SubtitleGroupingModelSelect.js',
    'src\services\gemini\narrationTextShortener.js',
    'src\services\gemini\subtitleGroupingModel.js',
    'src\styles\VideoAnalysisButton.css',
    'src\utils\consumeSseJsonStream.js',
    'src\utils\mediaCacheIdentity.js',
    'src\utils\narrationSubtitleSource.js',
    'server\routes\adaptiveSyncRoutes.js',
    'server\services\adaptiveSync\planner.js',
    'server\services\adaptiveSync\media.js',
    'src\services\adaptiveSyncService.js',
    'src\components\narration\components\AdaptiveSyncPanel.js',
    'src\components\previews\AdaptiveSyncPreview.js',
    'src\styles\narration\modules\results.css'
)

function Test-OmniVoiceLanguageCatalog {
    param([string]$Directory)
    $servicePath = Join-Path $Directory 'server\tts_service\omnivoice_service.py'
    $clientPath = Join-Path $Directory 'src\services\chatterboxService.js'
    $inputPath = Join-Path $Directory 'src\components\narration\components\NarrationInputSource.js'
    if (!(Test-Path -LiteralPath $servicePath) -or !(Test-Path -LiteralPath $clientPath) -or !(Test-Path -LiteralPath $inputPath)) {
        return $false
    }
    $service = Get-Content -LiteralPath $servicePath -Raw
    $client = Get-Content -LiteralPath $clientPath -Raw
    $inputComponent = Get-Content -LiteralPath $inputPath -Raw
    return $service.Contains('@app.get("/languages")') -and
        $service.Contains('@app.get("/api/narration/languages")') -and
        $service.Contains('LANG_NAME_TO_ID') -and
        $client.Contains('getOmniVoiceLanguages') -and
        $inputComponent.Contains('getOmniVoiceLanguages')
}

function Test-CompatibleProject {
    param([string]$Directory)
    $manifest = Join-Path $Directory 'package.json'
    if (!(Test-Path -LiteralPath $manifest)) { return $false }
    try { $package = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json }
    catch { return $false }
    if ($package.name -ne 'one-sub-tool' -or $package.version -ne $installerVersion -or !$package.scripts.'setup:tts') {
        return $false
    }
    foreach ($file in $requiredProjectFiles) {
        if (!(Test-Path -LiteralPath (Join-Path $Directory $file))) { return $false }
    }
    return (Test-OmniVoiceLanguageCatalog $Directory)
}

$project = if (Test-CompatibleProject $installerDirectory) {
    $installerDirectory
} else {
    Join-Path $installerDirectory 'One-sub-tool'
}

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments = @())
    Write-Host ('> ' + $Command + ' ' + ($Arguments -join ' ')) -ForegroundColor DarkCyan
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Lenh that bai (exit $LASTEXITCODE): $Command" }
}

function Refresh-Path {
    $paths = @($env:PATH, [Environment]::GetEnvironmentVariable('PATH', 'Machine'),
        [Environment]::GetEnvironmentVariable('PATH', 'User'), (Join-Path $HOME '.local\bin'))
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $uniquePaths = foreach ($entry in (($paths -join ';') -split ';')) {
        $entry = [Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"'))
        if ($entry -and $seen.Add($entry.TrimEnd('\'))) { $entry }
    }
    $env:PATH = $uniquePaths -join ';'
}

function Assert-Project {
    $manifest = Join-Path $project 'package.json'
    if (!(Test-Path -LiteralPath $manifest)) { throw "Chua co du an tai $project. Chon cai dat truoc." }
    $package = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    if ($package.name -ne 'one-sub-tool' -or $package.version -ne $installerVersion -or !$package.scripts.'setup:tts') {
        throw "Yeu cau source One-sub-tool $installerVersion; tim thay $($package.name) $($package.version). Hay dung bo cai trong thu muc rieng."
    }
    if (Test-Path -LiteralPath (Join-Path $project '.git')) {
        $origin = & git -C $project remote get-url origin 2>$null
        if ($LASTEXITCODE -eq 0 -and $origin -and $origin -notmatch '^(https://github\.com/|git@github\.com:)lythuachau/One-sub-tool(\.git)?/?$') {
            throw "origin khong tro toi One-sub-tool: $origin"
        }
    }
    foreach ($requiredFile in $requiredProjectFiles) {
        if (!(Test-Path -LiteralPath (Join-Path $project $requiredFile))) {
            throw "Source thieu file can thiet cho One-sub-tool ${installerVersion}: $requiredFile. Hay dung bo cai trong source v3 moi nhat."
        }
    }
    if (!(Test-OmniVoiceLanguageCatalog $project)) {
        throw "Source $installBranch chua co danh muc ngon ngu OmniVoice dong (endpoint /languages va lang_map). Hay cap nhat source release truoc khi cai de tranh cai phien ban cu."
    }
}

function Assert-Stopped {
    $ports = @(3030, 3031, 3032, 3033, 3034, 3035, 3036, 3038, 3039, 3040, 3041, 3042)
    foreach ($name in @('FRONTEND_PORT', 'BACKEND_PORT', 'WEBSOCKET_PORT', 'VIDEO_RENDERER_PORT',
        'VIDEO_RENDERER_FRONTEND_PORT', 'NARRATION_PORT', 'OMNIVOICE_PORT', 'CHATTERBOX_PORT',
        'PARAKEET_PORT', 'FW_TURBO_PORT', 'FW_LARGE_V3_PORT', 'QWEN3_ASR_17B_PORT', 'QWEN3_ASR_06B_PORT')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($value -match '^\d+$') { $ports += [int]$value }
    }
    $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    $active = @($listeners | Where-Object { $_.Port -in $ports } | Select-Object -ExpandProperty Port -Unique)
    if ($active.Count) { throw "Hay dung tool/dich vu tren cac cong $($active -join ', ') truoc khi cai dat/cap nhat. Khong tu tat tien trinh." }
}

function Install-Prerequisites {
    if (![Environment]::Is64BitOperatingSystem) { throw 'Yeu cau Windows 64-bit.' }
    foreach ($dependency in @(
        @{ Command = 'git'; Package = 'Git.Git' },
        @{ Command = 'node'; Package = 'OpenJS.NodeJS.LTS' },
        @{ Command = 'uv'; Package = 'astral-sh.uv' },
        @{ Command = 'ffmpeg'; Package = 'Gyan.FFmpeg' }
    )) {
        if (!(Get-Command $dependency.Command -ErrorAction SilentlyContinue)) {
            if (!(Get-Command winget -ErrorAction SilentlyContinue)) {
                throw "Thieu $($dependency.Command). Cai App Installer/winget hoac cai dependency nay thu cong, roi mo lai bo cai."
            }
            Invoke-Checked 'winget' @('install', '--id', $dependency.Package, '--exact', '--source', 'winget',
                '--accept-package-agreements', '--accept-source-agreements')
            Refresh-Path
            if (!(Get-Command $dependency.Command -ErrorAction SilentlyContinue)) {
                throw "Da cai $($dependency.Command); hay mo lai bo cai de nhan PATH moi."
            }
        }
    }
    Invoke-Checked 'node' @('-e', "const [a,b]=process.versions.node.split('.').map(Number); if(a<20||(a===20&&b<19)||process.arch!=='x64')process.exit(1)")
    foreach ($command in @('npm.cmd', 'ffprobe')) {
        if (!(Get-Command $command -ErrorAction SilentlyContinue)) { throw "Thieu $command trong PATH." }
    }
    Invoke-Checked 'ffmpeg' @('-version')
    Invoke-Checked 'ffprobe' @('-version')
}

function Ensure-Project {
    if (!(Test-Path -LiteralPath $project)) {
        Invoke-Checked 'git' @('clone', '--branch', $installBranch, '--single-branch', $repository, $project)
    }
    Assert-Project
}

function Ensure-Python {
    $python = Join-Path $project '.venv\Scripts\python.exe'
    if (!(Test-Path -LiteralPath $python)) {
        if (Test-Path -LiteralPath (Join-Path $project '.venv')) {
            throw '.venv ton tai nhung thieu python.exe. Hay doi ten moi truong hong truoc; bo cai giu nguyen du lieu.'
        }
        Invoke-Checked 'uv' @('venv', '--python', '3.11', (Join-Path $project '.venv'))
    }
    Invoke-Checked $python @('-c', "import sys; assert sys.version_info[:2] == (3, 11), 'Yeu cau Python 3.11; moi truong hien co duoc giu nguyen'")

}

function Install-Application {
    param([bool]$LocalTts)
    Assert-Stopped
    Install-Prerequisites
    Ensure-Project
    Push-Location -LiteralPath $project
    try {
        Ensure-Python | Out-Host
        $python = Join-Path $project '.venv\Scripts\python.exe'
        Invoke-Checked 'uv' @('python', 'install', '3.11')
        Write-Host 'Don dependency TTS cu trong .venv cua du an: gtts, edge-tts.'
        Invoke-Checked 'uv' @('pip', 'uninstall', '--python', $python, 'gtts', 'edge-tts')
        Write-Host 'Cai core + Gemini/API Vibi + CapCut. Khong sua API key, video, model cache hay lich su.'
        if (Test-Path -LiteralPath 'package-lock.json') {
            Invoke-Checked 'npm.cmd' @('ci', '--include=dev', '--no-audit', '--no-fund')
        } else {
            Write-Warning 'Repository chua co lockfile goc; dung npm install, khong tu xoa lockfile.'
            Invoke-Checked 'npm.cmd' @('install', '--include=dev', '--no-audit', '--no-fund')
        }
        Invoke-Checked 'node' @('-e', "for (const name of ['cross-env', 'concurrently', 'react-scripts']) { require.resolve(name + '/package.json'); console.log(name + ' OK'); }")
        Invoke-Checked 'npm.cmd' @('run', 'setup:react-env')
        Invoke-Checked $python @('-m', 'yt_dlp', '--version')
        Invoke-Checked 'node' @('node_modules/playwright/cli.js', 'install', 'chromium')
        Invoke-Checked $python @('scripts/setup-capcut.py')
        if ($LocalTts) {
            $device = Read-Host 'PyTorch: 1 = NVIDIA CUDA 12.6 (moi), 2 = NVIDIA CUDA 12.8 (tuong thich cu), 3 = CPU (nhap 1, 2 hoac 3)'
            switch ($device) {
                '1' {
                    $torchVersion = '2.14.1'
                    $torchAudioVersion = '2.11.0'
                    $torchIndex = 'https://download.pytorch.org/whl/cu126'
                    $deviceLabel = 'NVIDIA CUDA 12.6'
                }
                '2' {
                    $torchVersion = '2.11.0'
                    $torchAudioVersion = '2.11.0'
                    $torchIndex = 'https://download.pytorch.org/whl/cu128'
                    $deviceLabel = 'NVIDIA CUDA 12.8 compatibility'
                }
                '3' {
                    $torchVersion = '2.14.1'
                    $torchAudioVersion = '2.11.0'
                    $torchIndex = 'https://download.pytorch.org/whl/cpu'
                    $deviceLabel = 'CPU'
                }
                default { throw 'Hay chon dung 1, 2 hoac 3; khong tu thay doi cau hinh thiet bi.' }
            }
            Write-Host "Cai PyTorch $torchVersion va TorchAudio $torchAudioVersion ($deviceLabel)."
            Invoke-Checked 'uv' @('pip', 'install', '--python', $python, "torch==$torchVersion", "torchaudio==$torchAudioVersion", '--reinstall-package', 'torch', '--reinstall-package', 'torchaudio', '--index-url', $torchIndex)
            Invoke-Checked 'uv' @('pip', 'install', '--python', $python, '-r', 'server/tts_service/requirements.txt')
            $torchVersionCheck = "import vieneu,omnivoice,torch,torchaudio; assert torch.__version__.split('+')[0] == '$torchVersion','Unexpected torch version: '+torch.__version__; assert torchaudio.__version__.split('+')[0] == '$torchAudioVersion','Unexpected torchaudio version: '+torchaudio.__version__; print('TTS imports and versions OK; torch=' + torch.__version__ + '; torchaudio=' + torchaudio.__version__ + '; CUDA=' + str(torch.cuda.is_available()))"
            Invoke-Checked $python @('-c', $torchVersionCheck)
            $languageCatalogCheck = "import importlib.util,pathlib; package=importlib.util.find_spec('omnivoice'); root=next(iter(package.submodule_search_locations)); path=pathlib.Path(root)/'utils'/'lang_map.py'; spec=importlib.util.spec_from_file_location('_one_sub_omnivoice_lang_map',path); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); languages=getattr(module,'LANG_NAME_TO_ID',{}); assert len(languages)>3,'OmniVoice language map is incomplete'; assert 'ru' in languages.values(),'Russian language mapping is missing'; print('OmniVoice dynamic language catalog OK; languages='+str(len(languages)))"
            Invoke-Checked $python @('-c', $languageCatalogCheck)
            if ($device -in @('1', '2')) {
                Invoke-Checked $python @('-c', "import torch; assert torch.cuda.is_available(), 'CUDA chua san sang: kiem tra driver NVIDIA hoac chon cai CPU'; print(torch.zeros(1, device='cuda'))")
            }
        }
        Invoke-Checked 'uv' @('pip', 'check', '--python', $python)
        Invoke-Checked (Join-Path $project '.venv-capcut\Scripts\python.exe') @('-c', "from capcut_tts_api import CapCutClient; print('CapCut import OK')")
        Write-Host '[OK] Cai dat hoan tat. Chon Chay tool trong menu.' -ForegroundColor Green
        Write-Host "Thu muc chay dung: $project"
        Write-Host 'Gemini/Vibi: nhap key trong Cai dat. Lan dau mo TTS local co the tai model va mat nhieu thoi gian.'
    } finally { Pop-Location }
}

function Update-Application {
    Assert-Project
    Assert-Stopped
    Push-Location -LiteralPath $project
    try {
        $origin = & git remote get-url origin
        if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^(https://github\.com/|git@github\.com:)lythuachau/One-sub-tool(\.git)?/?$') {
            throw 'origin khong tro toi lythuachau/One-sub-tool; dung cap nhat de tranh lay nham upstream.'
        }
        $dirty = @(& git status --short --untracked-files=normal)
        if ($LASTEXITCODE -ne 0) { throw 'Khong doc duoc trang thai Git; bo cai khong thay doi source.' }
        if ($dirty.Count) {
            Write-Host 'Cac file thay doi (giu nguyen, bo cai khong tu sua):' -ForegroundColor Yellow
            $dirty | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
            throw 'Co thay doi chua commit. Hay backup/commit truoc; bo cai khong reset, stash hay xoa file.'
        }
        $branch = & git symbolic-ref --quiet --short HEAD
        if ($LASTEXITCODE -ne 0 -or !$branch) { throw 'Dang o tag/detached HEAD. Hay chon nhanh cap nhat truoc.' }
        $tracking = & git for-each-ref '--format=%(upstream:short)' "refs/heads/$branch"
        if ($LASTEXITCODE -ne 0 -or !$tracking -or !$tracking.StartsWith('origin/')) {
            throw 'Nhanh hien tai chua theo doi origin. Hay cau hinh upstream cua nhanh truoc.'
        }
        Invoke-Checked 'git' @('fetch', 'origin')
        $backup = 'backup-before-installer-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
        Invoke-Checked 'git' @('tag', $backup, 'HEAD')
        Invoke-Checked 'git' @('merge', '--ff-only', $tracking)
        Write-Host "[OK] Cap nhat nhanh $branch. Moc rollback ma nguon LOCAL: $backup" -ForegroundColor Green
        Write-Host 'Mo lai bo cai, chon cai/sua dependencies truoc khi chay. Tag local khong phai backup video/config.'
    } finally { Pop-Location }
}

function Start-Application {
    param([bool]$LocalTts)
    Assert-Project
    Assert-Stopped
    foreach ($module in @('react-scripts', 'cross-env', 'concurrently')) {
        if (!(Test-Path -LiteralPath (Join-Path $project "node_modules\$module\package.json"))) {
            throw "Thieu dependency $module. Chon 1 hoac 2 de cai du dependencies (--include=dev)."
        }
    }
    Push-Location -LiteralPath $project
    try {
        $scriptName = if ($LocalTts) { 'dev:cuda' } else { 'dev' }
        Write-Host 'Tool: http://localhost:3030 - Ctrl+C de dung. Khong cai lai dependencies khi khoi dong.'
        Invoke-Checked 'npm.cmd' @('run', $scriptName)
    } finally { Pop-Location }
}

function Show-Diagnostics {
    Write-Host "Bo cai: One-sub-tool $installerVersion; nguon: $repository ($installBranch)"
    Write-Host "Du an: $project"
    foreach ($command in @('git', 'node', 'npm.cmd', 'uv', 'ffmpeg', 'ffprobe')) {
        $found = Get-Command $command -ErrorAction SilentlyContinue
        if ($found) { Write-Host "[OK] $command : $($found.Source)" }
        else { Write-Host "[THIEU] $command" -ForegroundColor Yellow }
    }
    if (Test-Path -LiteralPath (Join-Path $project 'package.json')) {
        $package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
        Write-Host "Phien ban package: $($package.name) $($package.version)"
    }
    foreach ($file in @('.venv\Scripts\python.exe', '.venv-capcut\Scripts\python.exe',
        '.venv-capcut\Voice.json', 'node_modules\react-scripts\package.json', 'server\tts_service\requirements.txt',
        'server\tts_service\omnivoice_service.py', 'src\components\narration\components\NarrationInputSource.js',
        'server\engines\asrCatalog.js', 'server\routes\asrUploadRoutes.js',
        'asr_services\faster_whisper\app.py', 'asr_services\qwen3_asr\app.py', 'parakeet_wrapper\app.py')) {
        Write-Host ("{0}: {1}" -f $file, (Test-Path -LiteralPath (Join-Path $project $file)))
    }
    $languageCatalogReady = Test-OmniVoiceLanguageCatalog $project
    Write-Host ("OmniVoice dynamic language catalog: {0}" -f $(if ($languageCatalogReady) { 'OK' } else { 'MISSING' }))
    Write-Host ("Installer source compatibility: {0}" -f $(if (Test-CompatibleProject $project) { 'OK' } else { 'MISMATCH' }))
    Write-Host 'Kiem tra chi doc: khong tai model, khong goi API TTS, khong thay doi he thong.'
}

Refresh-Path
if ($env:ONE_SUB_INSTALLER_ACTION -eq '/check') { Show-Diagnostics; exit 0 }
if ($env:ONE_SUB_INSTALLER_ACTION -eq '/help') {
    Write-Host 'OSG_installer_Windows.bat [ /check | /help ]; khong tham so = menu One-sub-tool v3.'
    exit 0
}
if ($env:ONE_SUB_INSTALLER_ACTION) { Write-Error 'Tham so khong hop le. Dung /help.'; exit 1 }
while ($true) {
    Write-Host "`n=== One-sub-tool $installerVersion - Windows Installer ===" -ForegroundColor Cyan
    Write-Host "Du an: $project"
    Write-Host "Nguon cai moi: $repository ($installBranch)"
    if ($project -ne $installerDirectory -and (Test-Path -LiteralPath (Join-Path $installerDirectory 'package.json'))) {
        Write-Host 'Thu muc hien tai la source cu/khong tuong thich. Cai ban moi trong thu muc con; giu nguyen source va du lieu cu.' -ForegroundColor Yellow
        Write-Host 'Hay dung muc 4/5 de chay dung ban moi, thay vi npm run trong source cu.'
    }
    Write-Host '1. Cai / sua full: TTS + Gemini/Vibi + ASR catalog (tai model theo nhu cau)'
    Write-Host '2. Cai / sua API: CapCut + Vibi/Gemini, khong cai model TTS local'
    Write-Host '3. Cap nhat ma nguon an toan (giu nhanh, chi fast-forward)'
    Write-Host '4. Chay tool + VieNeu-TTS + OmniVoice'
    Write-Host '5. Chay tool API (khong khoi dong TTS local)'
    Write-Host '6. Kiem tra moi truong (chi doc)'
    Write-Host '7. Thoat'
    $choice = Read-Host 'Chon 1-7'
    if ($choice -eq '7' -or $null -eq $choice) { exit 0 }
    $transcribing = $false
    try {
        if ($choice -in @('1', '2', '3')) {
            $logDirectory = Join-Path $env:LOCALAPPDATA 'One-sub-tool\installer-logs'
            New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
            $log = Join-Path $logDirectory ((Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.log')
            Start-Transcript -LiteralPath $log | Out-Null
            $transcribing = $true
        }
        switch ($choice) {
            '1' { Install-Application $true }
            '2' { Install-Application $false }
            '3' { Update-Application }
            '4' { Start-Application $true }
            '5' { Start-Application $false }
            '6' { Show-Diagnostics }
            default { Write-Host 'Lua chon khong hop le.' }
        }
    } catch {
        Write-Host ("[LOI] " + $_.Exception.Message) -ForegroundColor Red
        Write-Host 'Dung tai buoc loi. Giu nguyen du lieu; sua nguyen nhan roi chay lai.'
    } finally {
        if ($transcribing) { Stop-Transcript | Out-Null; Write-Host "Log: $log" }
    }
}
