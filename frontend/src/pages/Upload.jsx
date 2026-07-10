import { useRef, useState } from 'react';
import { useUpload } from '../UploadContext.jsx';

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Upload() {
  const [file, setFile] = useState(null);
  const [sheetDate, setSheetDate] = useState(todayISO());
  const [fileError, setFileError] = useState(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const { isUploading, startUpload } = useUpload();

  const pick = (f) => {
    setFile(f || null);
    setFileError(null);
  };

  const submit = () => {
    if (!file) return;
    startUpload(file, sheetDate);
    setFile(null);
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
        {isUploading ? (
          <div className="upload-loading-card">
            <span className="spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
            <p style={{ fontWeight: 700, margin: '10px 0 2px' }}>Processing sheet…</p>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              This runs in the background — feel free to navigate away. Watch the sidebar for when it's ready.
            </p>
          </div>
        ) : (
          <>
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
              <button onClick={submit} disabled={!file || !sheetDate}>Upload & Extract</button>
            </div>

            {fileError && <div className="error-box">{fileError}</div>}
          </>
        )}
      </div>
    </>
  );
}
