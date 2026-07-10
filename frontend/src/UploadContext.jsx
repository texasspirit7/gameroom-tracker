import { createContext, useCallback, useContext, useState } from 'react';
import { api } from './api.js';

const UploadContext = createContext(null);

export function UploadProvider({ children }) {
  const [isUploading, setIsUploading] = useState(false);
  const [readySheetId, setReadySheetId] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  const startUpload = useCallback(async (file, sheetDate) => {
    setIsUploading(true);
    setReadySheetId(null);
    setUploadError(null);
    try {
      const result = await api.uploadSheet(file, sheetDate);
      setReadySheetId(result.sheetId);
    } catch (e) {
      setUploadError(e.message);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setReadySheetId(null);
    setUploadError(null);
  }, []);

  return (
    <UploadContext.Provider value={{ isUploading, readySheetId, uploadError, startUpload, clear }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  return useContext(UploadContext);
}
