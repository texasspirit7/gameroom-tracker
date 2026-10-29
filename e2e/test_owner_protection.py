"""
The owner account is the break-glass route back in, so nobody may take it away.

Checked from a *second* admin's session on purpose: from the owner's own session the
self-guards answer first and the owner-protection branch is never reached.
"""
import pytest

from helpers import ADMIN, OWNER, sign_in


@pytest.fixture(scope='module')
def owner_row(server, admin):
    # The owner has to have been here before there is a row to protect.
    sign_in(server.base_url, OWNER, 'la')
    roster = admin.get(server.url('/api/admin/users'), timeout=10).json()
    row = next(u for u in roster if u['email'] == OWNER['email'])
    assert row['isOwner'] is True, 'the roster has to say which row is the owner'
    return row


def test_another_admin_cannot_delete_the_owner(admin, server, owner_row):
    assert admin.delete(server.url(f"/api/admin/users/{owner_row['id']}"), timeout=10).status_code == 403


def test_another_admin_cannot_block_the_owner(admin, server, owner_row):
    res = admin.post(server.url(f"/api/admin/users/{owner_row['id']}/block"), timeout=10)
    assert res.status_code == 403


def test_another_admin_cannot_demote_the_owner(admin, server, owner_row):
    res = admin.post(
        server.url(f"/api/admin/users/{owner_row['id']}/role"),
        json={'role': 'user'},
        timeout=10,
    )
    assert res.status_code == 403


def test_the_owner_survived_all_three(admin, server, owner_row):
    roster = admin.get(server.url('/api/admin/users'), timeout=10).json()
    row = next(u for u in roster if u['email'] == OWNER['email'])
    assert row['status'] == 'approved'
    assert row['role'] == 'admin'


def test_an_ordinary_admin_is_not_protected(admin, server):
    """The protection is about one account, not about admins in general."""
    admin.post(server.url('/api/admin/users'), json={'email': 'spare@e2e.local', 'name': 'Spare'}, timeout=10)
    roster = admin.get(server.url('/api/admin/users'), timeout=10).json()
    spare = next(u for u in roster if u['email'] == 'spare@e2e.local')

    assert admin.delete(server.url(f"/api/admin/users/{spare['id']}"), timeout=10).status_code == 200
