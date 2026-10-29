"""
Read-only checks against a deployed site, for the minutes after a deploy.

Nothing here writes, signs in, or touches real money — it runs against the live app with real
data in it. `CLAUDE.md` is explicit that a green pipeline and a healthy server do not prove the
change shipped, so this also fetches the bundle the homepage actually references.

Run against production:  E2E_BASE_URL=https://whathappened.azurewebsites.net pytest -m production
"""
import os
import re

import pytest
import requests

BASE_URL = os.environ.get('E2E_BASE_URL', '').rstrip('/')

pytestmark = [
    pytest.mark.production,
    pytest.mark.skipif(not BASE_URL, reason='set E2E_BASE_URL to run the deployed-site checks'),
]


def test_the_site_is_healthy():
    body = requests.get(f'{BASE_URL}/api/health', timeout=30).json()
    assert body['ok'] is True


def test_it_is_serving_the_expected_locations():
    body = requests.get(f'{BASE_URL}/api/auth/config', timeout=30).json()
    assert body['locationNames'] == {'la': 'London', 'h': 'Helsinki'}


def test_production_requires_google_sign_in():
    """Passwordless local sign-in is a development convenience and must never be live."""
    body = requests.get(f'{BASE_URL}/api/auth/config', timeout=30).json()
    assert body['authEnabled'] is True
    assert body['authProvider'] == 'google'


def test_the_api_is_closed_to_strangers():
    for path in ('/api/sheets', '/api/dashboard', '/api/profit-split', '/api/admin/users'):
        assert requests.get(f'{BASE_URL}{path}', timeout=30).status_code == 401, path


def test_the_homepage_serves_a_real_bundle():
    page = requests.get(BASE_URL, timeout=30)
    assert page.status_code == 200

    match = re.search(r'/assets/(index-[A-Za-z0-9_-]+\.js)', page.text)
    assert match, 'the homepage does not reference a built bundle'

    bundle = requests.get(f'{BASE_URL}/assets/{match.group(1)}', timeout=60)
    assert bundle.status_code == 200
    assert len(bundle.content) > 100_000, 'bundle is suspiciously small — did the build run?'
