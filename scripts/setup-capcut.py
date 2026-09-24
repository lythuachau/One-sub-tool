import json
import subprocess
import sys
import urllib.request
from pathlib import Path

REVISION = 'e06da1f4e0c0010354f4e7702f02c18cbdd419a2'
ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / '.venv-capcut'

subprocess.run(['uv', 'venv', '--python', '3.11', str(ENV)], check=True)
python = ENV / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
subprocess.run(['uv', 'pip', 'install', '--python', str(python),
                f'git+https://github.com/K07VN/capcut-tts-api.git@{REVISION}'], check=True)
with urllib.request.urlopen(f'https://raw.githubusercontent.com/K07VN/capcut-tts-api/{REVISION}/Voice.json', timeout=30) as response:
    catalog = json.load(response)
destination = ENV / 'Voice.json'
temporary = destination.with_suffix('.tmp')
temporary.write_text(json.dumps(catalog, ensure_ascii=False), encoding='utf-8')
temporary.replace(destination)
print('CapCut SDK and voice catalog installed. No model or browser required.')
