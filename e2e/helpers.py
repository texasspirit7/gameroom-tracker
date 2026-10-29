"""Shared building blocks for the end-to-end tests."""
import io

import requests
from openpyxl import Workbook

XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

ADMIN = {'name': 'E2E Admin', 'email': 'admin@e2e.local'}
OWNER = {'name': 'E2E Owner', 'email': 'owner@e2e.local'}


def build_sheet_xlsx(total_in, total_out=0):
    """
    A minimal daily sheet in the shape the real xlsx extractor reads: the machine table with
    its header, a Total row, and the settlement line carrying Total In / Total Out.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = 'Sheet1'
    for row in (
        ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
        [1, 0, total_in, total_in, 0, total_out, total_out, '100%'],
        ['Total', None, None, total_in, None, None, total_out, '100%'],
        [None],
        ['Total Out', '$', total_out, 'Total In', '$', total_in, 'Bank'],
    ):
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def sign_in(base_url, credentials, location='la'):
    """
    The real two-step sign-in: identify, then enter a location. Returns a Session holding the
    session cookie, so tests drive the app exactly as a browser does.
    """
    session = requests.Session()
    res = session.post(f'{base_url}/api/auth/local', json=credentials, timeout=10)
    res.raise_for_status()
    res = session.post(f'{base_url}/api/auth/enter', json={'location': location}, timeout=10)
    res.raise_for_status()
    return session


def grant_access(admin_session, base_url, email, name='E2E User'):
    """Admins hand out access; without this an unknown address is offered no location at all."""
    res = admin_session.post(f'{base_url}/api/admin/users', json={'email': email, 'name': name}, timeout=10)
    res.raise_for_status()
    return res.json()


def upload_sheet(session, base_url, data, sheet_date=None, filename='sheet.xlsx'):
    form = {'sheet_date': sheet_date} if sheet_date else {}
    return session.post(
        f'{base_url}/api/sheets/upload',
        files={'file': (filename, data, XLSX_MIME)},
        data=form,
        timeout=60,
    )
