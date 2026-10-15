/** Parakeet's isolated ONNX ASR runtime and GPU-aware dependency installer. */

const { getEngineVenvTarget } = require('../venvPaths');
const { executeWithRetry, runCommand } = require('./execHelpers');
const { installServiceDeps } = require('./serviceDeps');
const torch = require('../torchProfile');

const ID = 'parakeet';
const ONNX_ASR_SPEC = 'onnx-asr==0.11.0';
const ONNX_RUNTIME_VERSION = '1.24.4';
const ONNX_RUNTIME_SPECS = {
  cpu: `onnxruntime==${ONNX_RUNTIME_VERSION}`,
  cuda: `onnxruntime-gpu==${ONNX_RUNTIME_VERSION}`,
  directml: `onnxruntime-directml==${ONNX_RUNTIME_VERSION}`,
};

async function install({ onLog = () => {} } = {}) {
  const log = (m) => onLog(String(m));
  const logger = {
    info: log, warning: log, progress: log, command: log, success: log,
    found: log, installing: log, subsection: log, step: () => {}, error: log,
  };

  const venv = getEngineVenvTarget(ID);

  // 1) Create the per-engine venv.
  logger.subsection('Creating Parakeet venv');
  await runCommand('uv', ['venv', venv, '-p', 'python3.11'], { label: 'Parakeet venv create', logger });

  // 2) Install torch so onnxruntime can preload the CUDA/cuDNN DLLs it bundles (see app.py).
  //    The resolved GPU vendor below picks the matching onnxruntime wheel, mirroring the source.
  const { vendor, profile } = torch.resolveTorchProfile(logger);
  logger.installing('PyTorch (provides CUDA/cuDNN DLLs for onnxruntime preload)');
  await executeWithRetry('uv', torch.buildTorchInstallArgs(profile, venv, true), { label: 'torch', logger });
  await torch.installTorchCompatibilityPackages(profile, venv, { logger });

  // 2b) FastAPI/uvicorn + audio IO the service (parakeet_wrapper/app.py) imports — not pulled by the
  //     ASR packages, so install them explicitly into this venv (see serviceDeps.js).
  await installServiceDeps(venv, { logger });

  // 3) Parakeet ASR dependencies.
  logger.installing('Parakeet ASR service dependencies');
  const parakeetEnv = { UV_HTTP_TIMEOUT: '600' };

  // Install the onnx-asr frontend (no --force-reinstall so its resolved deps stay stable).
  await executeWithRetry(
    'uv',
    ['pip', 'install', '--python', venv, ONNX_ASR_SPEC],
    { label: 'onnx-asr', env: parakeetEnv, logger }
  );

  // onnx (the model builder) — parakeet_wrapper/app.py's GPU probe (_cuda_actually_works) builds a
  // throwaway ONNX model with onnx.helper to test whether CUDA truly binds. Without onnx that probe
  // raises ModuleNotFoundError, gets swallowed, and the engine SILENTLY runs on CPU even on a working
  // NVIDIA GPU. onnx-asr does not pull it, so install it explicitly.
  await executeWithRetry(
    'uv',
    ['pip', 'install', '--python', venv, 'onnx'],
    { label: 'onnx', env: parakeetEnv, logger }
  );

  // Pick the onnxruntime wheel from the GPU vendor we already detected for PyTorch:
  //   NVIDIA -> onnxruntime-gpu (CUDA); AMD/INTEL on Windows -> onnxruntime-directml; else CPU onnxruntime.
  // If the GPU wheel fails to install, fall back to plain CPU onnxruntime so Parakeet still works.
  let onnxRuntimePkg = ONNX_RUNTIME_SPECS.cpu;
  if (vendor === 'NVIDIA') {
    onnxRuntimePkg = ONNX_RUNTIME_SPECS.cuda;
  } else if ((vendor === 'AMD' || vendor === 'INTEL') && process.platform === 'win32') {
    onnxRuntimePkg = ONNX_RUNTIME_SPECS.directml;
  }
  // Track the runtime we actually end up with so verification can assert the matching ORT provider.
  let installedRuntime = onnxRuntimePkg === ONNX_RUNTIME_SPECS.cuda ? 'cuda'
    : onnxRuntimePkg === ONNX_RUNTIME_SPECS.directml ? 'directml' : 'cpu';
  const installOrt = (pkg) => executeWithRetry(
    'uv',
    ['pip', 'install', '--python', venv, pkg, '--force-reinstall'],
    { label: `onnxruntime (${pkg})`, env: parakeetEnv, logger }
  );
  try {
    await installOrt(onnxRuntimePkg);
    logger.success(`Parakeet ASR: installed ${onnxRuntimePkg === ONNX_RUNTIME_SPECS.cpu ? 'CPU runtime onnxruntime' : 'GPU runtime ' + onnxRuntimePkg}`);
  } catch (gpuErr) {
    if (onnxRuntimePkg !== ONNX_RUNTIME_SPECS.cpu) {
      logger.warning(`GPU onnxruntime (${onnxRuntimePkg}) install failed: ${gpuErr.message}`);
      logger.info('Falling back to CPU onnxruntime so Parakeet still works (no GPU acceleration).');
      await installOrt(ONNX_RUNTIME_SPECS.cpu);
      installedRuntime = 'cpu';
      logger.success('Parakeet ASR: installed CPU runtime onnxruntime (fallback)');
    } else {
      throw gpuErr;
    }
  }
  logger.success('Parakeet ASR dependencies installed successfully');

  // 4) Verify the runtime is actually USABLE — not just importable. We import torch first (so its
  //    bundled CUDA/cuDNN DLLs are discoverable), run onnxruntime.preload_dlls() (the same call
  //    parakeet_wrapper/app.py makes — this is where a broken CUDA setup throws "Error 126"), then
  //    check providers. FATAL if a module is missing or no CPU provider exists (truly broken venv).
  //    A missing GPU provider after a GPU install is only a WARNING — the engine still runs on CPU.
  const EXPECTED_PROVIDER = { cpu: 'CPUExecutionProvider', cuda: 'CUDAExecutionProvider', directml: 'DmlExecutionProvider' }[installedRuntime];
  logger.progress(`Verifying Parakeet runtime (expecting ${EXPECTED_PROVIDER})`);
  const verifyParakeetPy = `
import sys
print('Python:', sys.executable)
missing = []
for mod, label in [('onnx_asr', 'onnx-asr'), ('onnxruntime', 'onnxruntime'), ('torch', 'torch'), ('onnx', 'onnx'), ('uvicorn', 'uvicorn'), ('fastapi', 'fastapi'), ('pydub', 'pydub'), ('pydantic', 'pydantic')]:
    try:
        __import__(mod)
    except Exception as e:
        missing.append(label + ' (' + str(e) + ')')
if missing:
    print('Missing:' + ','.join(missing))
    sys.exit(1)
import torch  # load torch first so onnxruntime can find the CUDA/cuDNN DLLs it bundles
import onnxruntime as ort
try:
    ort.preload_dlls()
except Exception as e:
    print('preload_dlls warning:', e)
providers = ort.get_available_providers()
print('Available providers:', providers)
if 'CPUExecutionProvider' not in providers:
    print('FATAL: onnxruntime has no usable execution provider')
    sys.exit(1)
expected = '${EXPECTED_PROVIDER}'
if expected == 'CUDAExecutionProvider':
    # CUDA being "available" (listed) does NOT mean it binds. Actually create a session forced onto
    # CUDA (same probe app.py uses at runtime). On an NVIDIA box this MUST bind GPU — fail the install
    # otherwise so it never silently degrades to CPU.
    from onnx import helper, TensorProto
    x = helper.make_tensor_value_info('X', TensorProto.FLOAT, [1, 2])
    y = helper.make_tensor_value_info('Y', TensorProto.FLOAT, [1, 2])
    g = helper.make_graph([helper.make_node('Identity', ['X'], ['Y'])], 'probe', [x], [y])
    m = helper.make_model(g, opset_imports=[helper.make_opsetid('', 13)])
    m.ir_version = 9
    s = ort.InferenceSession(m.SerializeToString(), providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
    bound = s.get_providers()
    print('Bound providers:', bound)
    if 'CUDAExecutionProvider' not in bound:
        print('FATAL: NVIDIA GPU was detected and the GPU runtime installed, but CUDAExecutionProvider')
        print('       failed to bind (CUDA/cuDNN DLL load issue). Refusing to leave Parakeet on CPU.')
        sys.exit(1)
    print('CUDA bind OK — Parakeet will run on GPU')
elif expected != 'CPUExecutionProvider' and expected not in providers:
    print('WARNING: ' + expected + ' is not available; Parakeet will run on CPU (no GPU acceleration).')
print('OK')
	`;
  await runCommand('uv', ['run', '--python', venv, '--', 'python', '-c', verifyParakeetPy], {
    label: 'Parakeet verify',
    logger,
  });
  logger.success('Parakeet dependencies verified');
}

module.exports = { id: ID, install };
