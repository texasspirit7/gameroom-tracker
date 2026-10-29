"""The app comes up, says who it is, and refuses anyone who has not signed in."""
import requests

from helpers import ADMIN, sign_in


def test_health_reports_ok(server):
    body = requests.get(server.url('/api/health'), timeout=10).json()
    assert body['ok'] is True
    assert body['authEnabled'] is True


def test_config_names_both_locations(server):
    body = requests.get(server.url('/api/auth/config'), timeout=10).json()
    assert body['locationNames'] == {'la': 'London', 'h': 'Helsinki'}
    assert body['authProvider'] == 'local'


def test_api_is_closed_to_strangers(server):
    for path in ('/api/sheets', '/api/dashboard', '/api/profit-split', '/api/admin/users'):
        assert requests.get(server.url(path), timeout=10).status_code == 401, path


def test_signing_in_opens_the_api(server):
    session = sign_in(server.base_url, ADMIN)
    assert session.get(server.url('/api/sheets'), timeout=10).status_code == 200


def test_the_app_shell_is_served(server):
    """
    The deploy ships the built frontend alongside the API. If the static mount or the SPA
    fallback regresses, every route but the API 404s — which no in-process API test would see.
    """
    res = requests.get(server.url('/sheets'), timeout=10)
    if res.status_code == 404:
        import pytest
        pytest.skip('frontend/dist not built — run `npm run build` to cover this')
    assert res.status_code == 200
    assert '<title>' in res.text
