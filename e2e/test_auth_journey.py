"""Sign in, pick a location, move between them, and leave."""
import requests

from helpers import ADMIN, grant_access, sign_in


def test_identify_then_enter(server):
    session = requests.Session()
    identified = session.post(server.url('/api/auth/local'), json=ADMIN, timeout=10)
    assert identified.status_code == 200

    # Identifying alone must not open anything — the session only exists after entering.
    assert session.get(server.url('/api/sheets'), timeout=10).status_code == 401

    offered = {loc['key'] for loc in identified.json()['locations']}
    assert offered == {'la', 'h'}, 'an admin address reaches both locations'

    entered = session.post(server.url('/api/auth/enter'), json={'location': 'la'}, timeout=10)
    assert entered.status_code == 200
    assert entered.json()['user']['location'] == 'la'


def test_the_session_knows_where_it_is(admin, server):
    user = admin.get(server.url('/api/auth/me'), timeout=10).json()['user']
    assert user['location'] == 'la'
    assert {loc['key']: loc['name'] for loc in user['locations']} == {'la': 'London', 'h': 'Helsinki'}


def test_switching_location_moves_the_session(server):
    session = sign_in(server.base_url, ADMIN, 'la')
    assert session.post(server.url('/api/auth/switch'), json={'location': 'h'}, timeout=10).status_code == 200
    assert session.get(server.url('/api/auth/me'), timeout=10).json()['user']['location'] == 'h'


def test_an_unknown_address_is_offered_nothing(server):
    session = requests.Session()
    res = session.post(
        server.url('/api/auth/local'),
        json={'name': 'Nobody', 'email': 'nobody@e2e.local'},
        timeout=10,
    )
    assert res.status_code == 200, 'identifying is allowed; it is entering that is not'
    assert res.json()['locations'] == []

    # And naming a location anyway is refused server-side, not just hidden in the UI.
    denied = session.post(server.url('/api/auth/enter'), json={'location': 'la'}, timeout=10)
    assert denied.status_code == 403


def test_access_granted_by_an_admin_opens_one_location(admin, server):
    grant_access(admin, server.base_url, 'granted@e2e.local')

    session = requests.Session()
    offered = session.post(
        server.url('/api/auth/local'),
        json={'name': 'Granted', 'email': 'granted@e2e.local'},
        timeout=10,
    ).json()['locations']
    assert [loc['key'] for loc in offered] == ['la'], 'granted in London only'

    assert session.post(server.url('/api/auth/enter'), json={'location': 'la'}, timeout=10).status_code == 200
    assert session.post(server.url('/api/auth/switch'), json={'location': 'h'}, timeout=10).status_code == 403


def test_signing_out_closes_the_session(server):
    session = sign_in(server.base_url, ADMIN)
    assert session.post(server.url('/api/auth/logout'), timeout=10).status_code == 200
    assert session.get(server.url('/api/sheets'), timeout=10).status_code == 401
