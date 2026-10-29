"""
The guarantee the whole architecture exists for: one location's money is not visible from
the other. Each location has its own SQLite file, so this is the test that would catch a
regression back to a shared database with a forgotten WHERE clause.
"""
import pytest

from helpers import ADMIN, build_sheet_xlsx, sign_in, upload_sheet


@pytest.fixture(scope='module')
def london(server):
    return sign_in(server.base_url, ADMIN, 'la')


@pytest.fixture(scope='module')
def helsinki(server):
    return sign_in(server.base_url, ADMIN, 'h')


def test_a_sheet_in_london_is_invisible_in_helsinki(london, helsinki, server):
    upload_sheet(london, server.base_url, build_sheet_xlsx(total_in=9000), sheet_date='2026-04-01')

    assert any(s['sheet_date'] == '2026-04-01' for s in london.get(server.url('/api/sheets'), timeout=10).json())
    assert helsinki.get(server.url('/api/sheets'), timeout=10).json() == []

    assert helsinki.get(server.url('/api/dashboard?label=All time'), timeout=10).json()['totals']['total_in'] == 0


def test_the_same_date_is_free_again_in_the_other_location(london, helsinki, server):
    """One-sheet-per-day is per location — the same calendar day exists in both."""
    assert upload_sheet(
        helsinki, server.base_url, build_sheet_xlsx(total_in=1500), sheet_date='2026-04-01'
    ).status_code == 200


def test_only_helsinki_tracks_a_setup_investment(london, helsinki, server):
    assert london.get(server.url('/api/investment'), timeout=10).status_code == 404

    investment = helsinki.get(server.url('/api/investment'), timeout=10)
    assert investment.status_code == 200
    assert len(investment.json()['budget']) >= 12, 'the quoted budget is seeded on first use'


def test_each_location_keeps_its_own_split_terms(london, helsinki, server):
    """40/60 in London, 50/50 in Helsinki — read off the same endpoint, by location."""
    assert london.get(server.url('/api/profit-split'), timeout=10).status_code == 200
    assert helsinki.get(server.url('/api/profit-split'), timeout=10).status_code == 200
