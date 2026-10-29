"""The journey the app exists for: a day's sheet goes in, and the figures come out."""
from helpers import build_sheet_xlsx, upload_sheet


def test_a_sheet_goes_in_and_shows_up_everywhere(admin, server):
    data = build_sheet_xlsx(total_in=8000, total_out=5000)
    res = upload_sheet(admin, server.base_url, data, sheet_date='2026-03-02')
    assert res.status_code == 200, res.text
    sheet_id = res.json()['sheetId']

    listed = admin.get(server.url('/api/sheets'), timeout=10).json()
    row = next(s for s in listed if s['id'] == sheet_id)
    assert row['sheet_date'] == '2026-03-02'
    assert row['total_in'] == 8000
    assert row['total_out'] == 5000

    dashboard = admin.get(server.url('/api/dashboard?label=All time'), timeout=10).json()
    assert dashboard['totals']['total_in'] >= 8000
    assert dashboard['latestDate'] == '2026-03-02'


def test_a_second_sheet_for_the_same_day_is_refused(admin, server):
    data = build_sheet_xlsx(total_in=1000)
    assert upload_sheet(admin, server.base_url, data, sheet_date='2026-03-05').status_code == 200

    clash = upload_sheet(admin, server.base_url, data, sheet_date='2026-03-05')
    assert clash.status_code == 409
    assert 'delete' in clash.json()['error'].lower(), 'the error has to say how to get past it'

    # And the refusal left nothing behind.
    dates = [s['sheet_date'] for s in admin.get(server.url('/api/sheets'), timeout=10).json()]
    assert dates.count('2026-03-05') == 1


def test_delete_then_reupload_is_the_way_to_replace_a_day(admin, server):
    data = build_sheet_xlsx(total_in=2000)
    first = upload_sheet(admin, server.base_url, data, sheet_date='2026-03-09').json()['sheetId']

    assert admin.delete(server.url(f'/api/sheets/{first}'), timeout=10).status_code == 200

    replacement = upload_sheet(admin, server.base_url, build_sheet_xlsx(total_in=2500), sheet_date='2026-03-09')
    assert replacement.status_code == 200

    rows = [s for s in admin.get(server.url('/api/sheets'), timeout=10).json() if s['sheet_date'] == '2026-03-09']
    assert len(rows) == 1
    assert rows[0]['total_in'] == 2500


def test_the_original_file_can_be_downloaded_back(admin, server):
    """Uploads are kept, not just parsed — the paper trail is the point of storing them."""
    sheet_id = upload_sheet(
        admin, server.base_url, build_sheet_xlsx(total_in=3000), sheet_date='2026-03-11'
    ).json()['sheetId']

    res = admin.get(server.url(f'/api/sheets/{sheet_id}/file'), timeout=10)
    assert res.status_code == 200
    assert res.content[:2] == b'PK', 'an xlsx is a zip; this should come back byte-for-byte'
