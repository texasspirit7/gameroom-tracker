"""
What is owed, what has been settled, and what is left — the numbers the owner actually reads.
Money moving the wrong way here is the most expensive bug this app can have.
"""
import pytest

from helpers import ADMIN, build_sheet_xlsx, grant_access, sign_in, upload_sheet


@pytest.fixture(scope='module')
def account(admin, server):
    """A week's sheet in London, so there is something owed to settle against."""
    upload_sheet(admin, server.base_url, build_sheet_xlsx(total_in=10000, total_out=4000), sheet_date='2026-09-07')
    return admin.get(server.url('/api/profit-split'), timeout=10).json()['account']


def test_a_sheet_creates_something_owed(account):
    assert account['owed_total'] > 0

    # London does not start empty. Everything to Sunday 2026-08-23 was settled in one $7,400
    # payment and is carried as a closed period — counted as both owed and received, so it
    # shows in the history without ever affecting what is still outstanding.
    assert account['received_total'] == pytest.approx(7400, abs=0.01)
    assert account['balance'] == pytest.approx(
        account['owed_total'] - account['received_total'] - account['expenses_total'], abs=0.01
    )


def test_a_payment_draws_the_balance_down(admin, server, account):
    before = admin.get(server.url('/api/profit-split'), timeout=10).json()['account']

    res = admin.post(
        server.url('/api/profit-split/receipts'),
        json={'received_on': '2026-09-10', 'amount': 500, 'note': 'e2e payment'},
        timeout=10,
    )
    assert res.status_code == 201

    after = admin.get(server.url('/api/profit-split'), timeout=10).json()['account']
    assert after['received_total'] == pytest.approx(before['received_total'] + 500, abs=0.01)
    assert after['balance'] == pytest.approx(before['balance'] - 500, abs=0.01)
    assert after['owed_total'] == pytest.approx(before['owed_total'], abs=0.01), \
        'settling must never move the split itself'


def test_an_expense_settles_like_a_payment(admin, server, account):
    before = admin.get(server.url('/api/profit-split'), timeout=10).json()['account']

    res = admin.post(
        server.url('/api/profit-split/expenses'),
        json={'expense_date': '2026-09-11', 'amount': 250, 'note': 'e2e expense'},
        timeout=10,
    )
    assert res.status_code == 201

    after = admin.get(server.url('/api/profit-split'), timeout=10).json()['account']
    assert after['expenses_total'] == pytest.approx(before['expenses_total'] + 250, abs=0.01)
    assert after['balance'] == pytest.approx(before['balance'] - 250, abs=0.01)


def test_deleting_a_payment_puts_the_balance_back(admin, server, account):
    before = admin.get(server.url('/api/profit-split'), timeout=10).json()['account']

    receipt = admin.post(
        server.url('/api/profit-split/receipts'),
        json={'received_on': '2026-09-12', 'amount': 100},
        timeout=10,
    ).json()
    admin.delete(server.url(f"/api/profit-split/receipts/{receipt['id']}"), timeout=10)

    after = admin.get(server.url('/api/profit-split'), timeout=10).json()['account']
    assert after['balance'] == pytest.approx(before['balance'], abs=0.01)


def test_a_nonsense_payment_is_refused(admin, server):
    for body in (
        {'received_on': '2026-09-13', 'amount': -5},
        {'received_on': 'not-a-date', 'amount': 10},
        {'received_on': '2026-09-13', 'amount': 0},
    ):
        assert admin.post(server.url('/api/profit-split/receipts'), json=body, timeout=10).status_code == 400, body


def test_the_split_is_closed_to_ordinary_users(admin, server):
    grant_access(admin, server.base_url, 'ordinary@e2e.local')
    user = sign_in(server.base_url, {'name': 'Ordinary', 'email': 'ordinary@e2e.local'}, 'la')

    assert user.get(server.url('/api/profit-split'), timeout=10).status_code == 403
    assert user.post(
        server.url('/api/profit-split/receipts'),
        json={'received_on': '2026-09-14', 'amount': 1000},
        timeout=10,
    ).status_code == 403
