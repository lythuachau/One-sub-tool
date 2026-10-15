/** GPU detection and compatible PyTorch wheel selection for isolated local ASR runtimes. */

const { execSync } = require('child_process');
const { runCommand } = require('./installers/execHelpers');

// A logger that silently swallows any .info()/.warning()/.command()/... call, so callers can pass a
// real logger or nothing.
const noopLogger = new Proxy({}, { get: () => () => {} });

const TORCH_PROFILES = {
  NVIDIA_CU121: {
    id: 'nvidia-cu121',
    torch: '2.5.1+cu121',
    torchvision: '0.20.1+cu121',
    torchaudio: '2.5.1+cu121',
    expectedTorch: '2.5.1',
    expectedTorchvision: '0.20.1',
    indexUrl: 'https://download.pytorch.org/whl/cu121',
    description: 'PyTorch 2.5.1 with CUDA 12.1',
    installNotes: 'Ensure NVIDIA drivers compatible with CUDA 12.1+ are installed.',
    compatibilityPackages: [],
  },
  NVIDIA_BLACKWELL_CU128: {
    id: 'nvidia-blackwell-cu128',
    torch: '2.7.1+cu128',
    torchvision: '0.22.1+cu128',
    torchaudio: '2.7.1+cu128',
    expectedTorch: '2.7.1',
    expectedTorchvision: '0.22.1',
    indexUrl: 'https://download.pytorch.org/whl/cu128',
    description: 'PyTorch 2.7.1 with CUDA 12.8 for NVIDIA Blackwell GPUs',
    installNotes: 'Detected a Blackwell-class NVIDIA GPU. Installing the CUDA 12.8 PyTorch build so kernels for sm_120 GPUs are available.',
    compatibilityPackages: ['numpy==1.25.2', 'pillow==11.3.0'],
  },
  CPU_GENERIC: {
    id: 'cpu-generic',
    torch: '2.5.1',
    torchvision: '0.20.1',
    torchaudio: '2.5.1',
    expectedTorch: '2.5.1',
    expectedTorchvision: '0.20.1',
    indexUrl: null,
    description: 'PyTorch 2.5.1 CPU/MPS/XPU-compatible build',
    installNotes: 'Installed PyTorch 2.5.1 without CUDA-specific wheels for broad compatibility.',
    compatibilityPackages: [],
  },
};

const BLACKWELL_GPU_REGEX = /\b(BLACKWELL|RTX 5090|RTX 5080|RTX 5070|RTX 5060|RTX 5050)\b/i;

function commandExists(command) {
  try {
    const baseCommand = command.split(' ')[0];
    const checkCmd = process.platform === 'win32' ? `where ${baseCommand}` : `command -v ${baseCommand}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

function detectNvidiaTorchProfile(logger = noopLogger) {
  const forcedTorchProfile = process.env.FORCE_TORCH_PROFILE?.toUpperCase();
  if (forcedTorchProfile === 'BLACKWELL') {
    logger.info('User override detected: FORCE_TORCH_PROFILE=BLACKWELL');
    return TORCH_PROFILES.NVIDIA_BLACKWELL_CU128;
  }
  if (forcedTorchProfile === 'DEFAULT') {
    logger.info('User override detected: FORCE_TORCH_PROFILE=DEFAULT');
    return TORCH_PROFILES.NVIDIA_CU121;
  }
  if (!commandExists('nvidia-smi')) {
    return TORCH_PROFILES.NVIDIA_CU121;
  }
  try {
    const gpuNames = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', { encoding: 'utf8' })
      .split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
    if (gpuNames.some((name) => BLACKWELL_GPU_REGEX.test(name))) {
      logger.info(`Detected Blackwell-class NVIDIA GPU: ${gpuNames.join(', ')}`);
      return TORCH_PROFILES.NVIDIA_BLACKWELL_CU128;
    }
  } catch (error) {
    logger.warning(`Could not inspect NVIDIA GPU model for Torch profile selection: ${error.message}`);
  }
  return TORCH_PROFILES.NVIDIA_CU121;
}

function detectGpuVendor(logger = noopLogger) {
  logger.subsection('GPU Detection');
  const platform = process.platform;
  const arch = process.arch;

  const forcedVendor = process.env.FORCE_GPU_VENDOR?.toUpperCase();
  if (forcedVendor && ['NVIDIA', 'AMD', 'INTEL', 'APPLE', 'CPU'].includes(forcedVendor)) {
    logger.info(`User override detected: FORCE_GPU_VENDOR=${forcedVendor}`);
    return forcedVendor === 'APPLE' ? 'APPLE_SILICON' : forcedVendor;
  }
  if (platform === 'darwin' && arch === 'arm64') {
    logger.found('Apple Silicon (macOS arm64)');
    return 'APPLE_SILICON';
  }
  if (commandExists('nvidia-smi')) {
    try {
      execSync('nvidia-smi -L', { stdio: 'ignore' });
      logger.found('NVIDIA GPU', 'via nvidia-smi');
      return 'NVIDIA';
    } catch (error) {
      logger.warning('nvidia-smi found but execution failed, checking other methods...');
    }
  }
  try {
    if (platform === 'win32') {
      let videoOutput = '';
      try {
        videoOutput = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController).Name"', { encoding: 'utf8' }).toUpperCase();
      } catch (cimErr) {
        try {
          videoOutput = execSync('wmic path win32_VideoController get name', { encoding: 'utf8' }).toUpperCase();
        } catch (wmicErr) {
          videoOutput = '';
        }
      }
      if (videoOutput.includes('NVIDIA')) { logger.found('NVIDIA GPU', 'via WMIC'); return 'NVIDIA'; }
      if (videoOutput.includes('AMD') || videoOutput.includes('RADEON')) { logger.found('AMD GPU', 'via WMIC'); return 'AMD'; }
      if (videoOutput.includes('INTEL')) { logger.found('Intel GPU', 'via WMIC'); return 'INTEL'; }
    } else if (platform === 'linux') {
      if (commandExists('lspci')) {
        const lspciOutput = execSync("lspci | grep -i 'VGA\\|3D\\|2D'", { encoding: 'utf8' }).toUpperCase();
        if (lspciOutput.includes('NVIDIA')) { logger.found('NVIDIA GPU', 'via lspci'); return 'NVIDIA'; }
        if (lspciOutput.includes('ADVANCED MICRO DEVICES') || lspciOutput.includes('AMD') || lspciOutput.includes('ATI') || lspciOutput.includes('RADEON')) { logger.found('AMD GPU', 'via lspci'); return 'AMD'; }
        if (lspciOutput.includes('INTEL')) { logger.found('Intel GPU', 'via lspci'); return 'INTEL'; }
      } else {
        logger.warning("'lspci' command not found, cannot perform detailed PCI check on Linux.");
      }
    }
  } catch (error) {
    logger.warning(`Error during GPU detection using system commands: ${error.message}`);
  }
  logger.warning('Could not reliably detect a supported accelerated GPU vendor.');
  return 'CPU';
}

/** Detect the GPU and pick the matching torch profile (+ user-facing install notes). */
function resolveTorchProfile(logger = noopLogger) {
  const vendor = detectGpuVendor(logger);
  let profile = TORCH_PROFILES.CPU_GENERIC;
  let installNotes = '';
  switch (vendor) {
    case 'NVIDIA':
      profile = detectNvidiaTorchProfile(logger);
      break;
    case 'AMD':
      installNotes = 'Using CPU-compatible PyTorch wheels for broad compatibility. ROCm support may be limited on this setup.';
      break;
    case 'INTEL':
      installNotes = 'Using CPU-compatible PyTorch wheels for broad compatibility. Intel GPU support may be limited.';
      break;
    case 'APPLE_SILICON':
      installNotes = 'Using PyTorch 2.5.1 with Metal Performance Shaders (MPS) support.';
      break;
    case 'CPU':
    default:
      installNotes = 'Installed PyTorch 2.5.1 CPU-only version. No GPU acceleration will be used.';
      break;
  }
  return { vendor, profile, installNotes: installNotes || profile.installNotes };
}

/** Build the `uv pip install torch...` command for a profile, targeting a specific venv. */
function buildTorchInstallCommand(profile, venvDir, includePython = false) {
  const pythonArg = includePython && venvDir ? ` --python "${venvDir}"` : '';
  const indexArg = profile.indexUrl ? ` --index-url ${profile.indexUrl}` : '';
  return `uv pip install${pythonArg} torch==${profile.torch} torchvision==${profile.torchvision} torchaudio==${profile.torchaudio}${indexArg} --force-reinstall`;
}

function buildTorchInstallArgs(profile, venvDir, includePython = false) {
  const args = ['pip', 'install'];
  if (includePython && venvDir) args.push('--python', venvDir);
  args.push(
    `torch==${profile.torch}`,
    `torchvision==${profile.torchvision}`,
    `torchaudio==${profile.torchaudio}`
  );
  if (profile.indexUrl) args.push('--index-url', profile.indexUrl);
  args.push('--force-reinstall');
  return args;
}

/** Install any extra packages a profile needs (e.g. pinned numpy on Blackwell) into a venv. */
async function installTorchCompatibilityPackages(profile, venvDir, { logger = noopLogger } = {}) {
  if (!profile.compatibilityPackages || profile.compatibilityPackages.length === 0) return;
  const args = ['pip', 'install', '--python', venvDir, ...profile.compatibilityPackages];
  logger.progress(`Installing compatibility packages for ${profile.description}`);
  await runCommand('uv', args, { label: 'torch compatibility packages', logger });
}

module.exports = {
  TORCH_PROFILES,
  BLACKWELL_GPU_REGEX,
  commandExists,
  detectGpuVendor,
  detectNvidiaTorchProfile,
  resolveTorchProfile,
  buildTorchInstallCommand,
  buildTorchInstallArgs,
  installTorchCompatibilityPackages,
};
