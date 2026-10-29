"""
Boots the real app as a separate process and drives it over HTTP.

This is deliberately one level out from `backend/tests/*.test.js`: those import the Express app
into the test process, these spawn `node backend/server.js` the way Azure does and talk to it
across a socket. That covers the seams the in-process tests cannot — server startup, config
read from the environment, SQLite on a real directory, and the built frontend being served.
"""
import os
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path

import pytest
import requests

from helpers import ADMIN, OWNER, sign_in

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOT_TIMEOUT_SECONDS = 60


def _free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Server:
    def __init__(self, base_url, data_dir):
        self.base_url = base_url
        self.data_dir = data_dir

    def url(self, path):
        return f'{self.base_url}{path}'


@pytest.fixture(scope='module')
def server():
    """
    One server per test file, on its own port with its own empty data directory. Per file
    rather than per test because booting Node costs about a second; per file rather than per
    session so one file's sheets and users cannot explain another file's result.
    """
    data_dir = Path(tempfile.mkdtemp(prefix='gameroom-e2e-'))
    port = _free_port()
    env = {
        **os.environ,
        'DATA_DIR': str(data_dir),
        'PORT': str(port),
        'NODE_ENV': 'test',
        'AUTH_ENABLED': 'true',
        'AUTH_PROVIDER': 'local',
        # Blank so sign-in stays on the local provider and photo extraction is never attempted.
        'GOOGLE_CLIENT_ID': '',
        'ANTHROPIC_API_KEY': '',
        'ADMIN_EMAILS': f"{ADMIN['email']},{OWNER['email']}",
        # The owner is deliberately not the ordinary admin, so the two boundaries stay testable.
        'OWNER_EMAIL': OWNER['email'],
        'JWT_SECRET': 'e2e-only-secret',
    }

    proc = subprocess.Popen(
        ['node', 'backend/server.js'],
        cwd=REPO_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    base_url = f'http://127.0.0.1:{port}'

    deadline = time.time() + BOOT_TIMEOUT_SECONDS
    healthy = False
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f'server exited during boot:\n{proc.stdout.read()}')
        try:
            res = requests.get(f'{base_url}/api/health', timeout=2)
            if res.ok and res.json().get('ok'):
                healthy = True
                break
        except requests.RequestException:
            pass
        time.sleep(0.2)

    if not healthy:
        proc.kill()
        raise RuntimeError(f'server never became healthy within {BOOT_TIMEOUT_SECONDS}s')

    yield Server(base_url, data_dir)

    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    shutil.rmtree(data_dir, ignore_errors=True)


@pytest.fixture(scope='module')
def admin(server):
    """An approved admin in London, which is where most journeys start."""
    return sign_in(server.base_url, ADMIN, 'la')
