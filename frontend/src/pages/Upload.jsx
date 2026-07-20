import { useRef, useState } from 'react';
import { useUpload } from '../UploadContext.jsx';

export default function Upload() {
  const [file, setFile] = useState(null);
  const [sheetDate, setSheetDate] = useState('');
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
        The sheet date is auto-detected from the sheet itself — only set it manually if you need to override
        that (e.g. backfilling, or the date wasn't readable). Uploading more than one sheet on the same date
        is fine (e.g. separate shifts) — both are kept.
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
                Sheet date (optional — auto-detected)
                <input type="date" value={sheetDate} onChange={(e) => setSheetDate(e.target.value)} />
              </label>
              <button onClick={submit} disabled={!file}>Upload & Extract</button>
            </div>

            {fileError && <div className="error-box">{fileError}</div>}
          </>
        )}
      </div>
    </>
  );
}
