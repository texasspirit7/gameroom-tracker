import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Upload() {
  const [file, setFile] = useState(null);
  const [sheetDate, setSheetDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const pick = (f) => {
    setFile(f || null);
    setError(null);
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.uploadSheet(file, sheetDate);
      navigate(`/sheets/${result.sheetId}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Upload Daily Sheet</h1>
      <div className="page-sub">
        Excel (.xlsx) is read directly. Photos (.jpg/.png) are read with AI — always review before verifying.
        Defaults to today — change it if you're backfilling a previous day. Uploading more than one sheet
        on the same date is fine (e.g. separate shifts) — both are kept.
      </div>

      <div className="panel">
        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
        >
          <div className="big">📄</div>
          {file ? <strong>{file.name}</strong> : <>Drop the daily sheet here, or click to browse<br /><span style={{ fontSize: 12 }}>.xlsx · .jpg · .png · .webp</span></>}
          <input
            ref={inputRef} type="file" hidden
            accept=".xlsx,.xlsm,.xls,.jpg,.jpeg,.png,.webp"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>

        <div className="form-row" style={{ marginTop: 16 }}>
          <label>
            Sheet date
            <input type="date" value={sheetDate} onChange={(e) => setSheetDate(e.target.value)} />
          </label>
          <button onClick={submit} disabled={!file || busy || !sheetDate}>
            {busy ? <><span className="spinner" />Extracting…</> : 'Upload & Extract'}
          </button>
        </div>

        {error && <div className="error-box">{error}</div>}
      </div>
    </>
  );
}
