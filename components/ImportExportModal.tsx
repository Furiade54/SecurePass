import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { Html5Qrcode } from 'html5-qrcode';
import jsQR from 'jsqr';
import { PasswordEntry } from '../types';
import { EncryptedData, EncryptionService } from '../utils/encryption';
import {
  ImportExportIcon,
  ZapIcon,
  ZapOffIcon,
  SwitchCameraIcon,
  CameraIcon
} from './Icons';
import GesturePad from './GesturePad';

const patternToString = (pattern: number[]): string => pattern.join(',');

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (passwords: PasswordEntry[]) => void;
  onExportSuccess?: () => void;
  passwords: PasswordEntry[];
  /**
   * 'modal'     → comportamiento histórico: overlay centrado, padding, max-w, max-h-90vh.
   *                Usado para export/import y selector de acción.
   * 'fullscreen'→ vista de página, ancho y alto completos.
   *                Ideal para flujos shareQR / scanQR en móvil:
   *                el scanner de cámara ocupa todo el ancho del viewport.
   * 'auto'      → si el modo interno es shareQR o scanQR → fullscreen, si no → modal.
   *                Valor por defecto para no romper llamadas existentes.
   */
  variant?: 'modal' | 'fullscreen' | 'auto';
  /**
   * Forzar modo inicial interno cuando se abre desde acceso directo.
   * Ej: abrir directamente en 'scanQR' saltándose el selector.
   */
  initialMode?: Mode | null;
}

type Mode = 'select' | 'export' | 'import' | 'shareQR' | 'scanQR';
type ImportMode = 'merge' | 'overwrite';
type ScanSource = 'camera' | 'image' | null;

type QRSharePayload = QRSharePayloadV2 | QRSharePayloadV3;

interface QRSharePayloadV2 {
  app: 'SecurePass';
  version: '2.0';
  type: 'password-share';
  timestamp: number;
  encrypted: EncryptedData;
}

interface QRSharePayloadV3 {
  app: 'SecurePass';
  version: '3.0';
  type: 'password-share';
  timestamp: number;
  transferId: string;
  chunkIndex: number;
  totalChunks: number;
  encryptedChunk: string;
}

interface ReceivedChunksMap {
  [transferId: string]: {
    totalChunks: number;
    chunks: { [chunkIndex: number]: string };
  };
}

interface QRTransferPassword {
  site: string;
  username: string;
  password: string;
  category: string;
}

const QR_READER_ELEMENT_ID = 'securepass-qr-reader';
const QR_IMAGE_WORKER_ELEMENT_ID = 'securepass-qr-image-worker';
const MAX_QR_PAYLOAD_BYTES = 720;
const QR_V3_FIXED_OVERHEAD_ESTIMATE_BYTES = 220;
const QR_IMAGE_ERROR_MESSAGE = 'No se detecto un QR legible. Usa una imagen con el codigo completo y buena resolucion.';

const normalizePasswords = (rawPasswords: any[]): PasswordEntry[] => {
  return rawPasswords.map((password) => ({
    id: password.id || crypto.randomUUID(),
    site: password.site,
    username: password.username,
    password: password.password,
    category: password.category || 'Uncategorized',
    createdAt: password.createdAt || Date.now()
  }));
};

const utf8ToBase64Safe = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
};

const base64SafeToUtf8 = (value: string): string => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
};

const generateTransferId = (): string => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const splitStringIntoChunks = (value: string, chunkSize: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    out.push(value.slice(i, i + chunkSize));
  }
  return out;
};

const estimateChunkSizeForEncryptedChunk = (transferId: string, totalChunks: number): number => {
  const skeleton: QRSharePayloadV3 = {
    app: 'SecurePass',
    version: '3.0',
    type: 'password-share',
    timestamp: Date.now(),
    transferId,
    chunkIndex: totalChunks,
    totalChunks,
    encryptedChunk: ''
  };
  const skeletonBytes = new TextEncoder().encode(JSON.stringify(skeleton)).length;
  const safeOverhead = skeletonBytes + 24;
  const remaining = Math.max(16, MAX_QR_PAYLOAD_BYTES - safeOverhead);
  return Math.max(32, remaining);
};

const estimateQRChunksNeeded = (
  payload: { passwords: QRTransferPassword[] },
  patternStr: string
): number => {
  try {
    const encrypted = EncryptionService.encrypt(JSON.stringify(payload), patternStr);
    const encryptedStr = JSON.stringify(encrypted);
    const b64 = utf8ToBase64Safe(encryptedStr);
    const transferId = generateTransferId();
    let chunkSize = estimateChunkSizeForEncryptedChunk(transferId, 2);
    let chunks = splitStringIntoChunks(b64, chunkSize);
    chunkSize = estimateChunkSizeForEncryptedChunk(transferId, chunks.length);
    chunks = splitStringIntoChunks(b64, chunkSize);
    return chunks.length;
  } catch {
    return 1;
  }
};

const roughEstimateQRChunks = (passwordsForTransfer: QRTransferPassword[]): number => {
  if (passwordsForTransfer.length === 0) return 0;
  const roughSingleEntryBytes =
    JSON.stringify(passwordsForTransfer[0]).length + 16;
  const rawBytes =
    48 + passwordsForTransfer.length * Math.max(120, roughSingleEntryBytes);
  const encryptedRough = rawBytes * 1.25 + 160;
  const b64Rough = Math.ceil(encryptedRough * 1.34);
  const skeletonBytes = QR_V3_FIXED_OVERHEAD_ESTIMATE_BYTES;
  const perChunk = Math.max(64, MAX_QR_PAYLOAD_BYTES - skeletonBytes);
  return Math.max(1, Math.ceil(b64Rough / perChunk));
};

const isValidQRPayload = (payload: any): payload is QRSharePayload => {
  if (
    !payload ||
    payload.app !== 'SecurePass' ||
    payload.type !== 'password-share' ||
    typeof payload.version !== 'string' ||
    typeof payload.timestamp !== 'number'
  ) {
    return false;
  }
  if (payload.version === '2.0') {
    return !!(
      payload.encrypted &&
      typeof payload.encrypted.data === 'string' &&
      typeof payload.encrypted.iv === 'string' &&
      typeof payload.encrypted.salt === 'string'
    );
  }
  if (payload.version === '3.0') {
    return !!(
      typeof payload.transferId === 'string' &&
      typeof payload.chunkIndex === 'number' &&
      typeof payload.totalChunks === 'number' &&
      typeof payload.encryptedChunk === 'string' &&
      payload.totalChunks >= 1 &&
      payload.chunkIndex >= 1 &&
      payload.chunkIndex <= payload.totalChunks
    );
  }
  return false;
};

const serializeUnknownError = (error: unknown): string => {
  if (error == null) return 'sin detalles';
  if (typeof error === 'string') return error || 'error vacío';
  if (error instanceof Error) return error.message || error.name || 'Error sin mensaje';
  try {
    const asAny = error as any;
    if (typeof asAny.message === 'string' && asAny.message) return asAny.message;
    if (typeof asAny.name === 'string' && asAny.name) return asAny.name;
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const loadImageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        resolve(img);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo decodificar la imagen (formato no soportado o corrupto).'));
    };
    img.src = url;
  });

const extractImageData = (
  img: HTMLImageElement,
  targetSize: number,
  paddingPct: number
): ImageData => {
  const canvas = document.createElement('canvas');
  const paddingPx = Math.max(0, Math.floor(targetSize * paddingPct));
  const inner = targetSize - paddingPx * 2;
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo obtener contexto de canvas.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = targetSize > Math.max(img.width, img.height);
  ctx.drawImage(img, paddingPx, paddingPx, inner, inner);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};

const ensureQrImageWorkerElement = (): HTMLElement => {
  let el = document.getElementById(QR_IMAGE_WORKER_ELEMENT_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = QR_IMAGE_WORKER_ELEMENT_ID;
  Object.assign((el as HTMLDivElement).style, {
    position: 'fixed',
    left: '-10000px',
    top: '-10000px',
    width: '640px',
    height: '480px',
    visibility: 'hidden',
    opacity: '0',
    pointerEvents: 'none'
  });
  document.body.appendChild(el);
  return el;
};

const removeQrImageWorkerElement = (): void => {
  const el = document.getElementById(QR_IMAGE_WORKER_ELEMENT_ID);
  if (el && el.parentNode) el.parentNode.removeChild(el);
};

const tryDecodeWithHtml5Qr = async (
  imageDataList: ImageData[],
  capturedErrors: string[]
): Promise<string | null> => {
  let scanner: Html5Qrcode | null = null;
  try {
    ensureQrImageWorkerElement();
    scanner = new Html5Qrcode(QR_IMAGE_WORKER_ELEMENT_ID);
    for (const imageData of imageDataList) {
      try {
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = imageData.width;
        tmpCanvas.height = imageData.height;
        const tctx = tmpCanvas.getContext('2d');
        if (!tctx) continue;
        tctx.putImageData(imageData, 0, 0);
        const blob: Blob | null = await new Promise((resolveBlob) =>
          tmpCanvas.toBlob((b) => resolveBlob(b), 'image/png')
        );
        if (!blob) continue;
        const fileLike = new File([blob], 'qr-candidate.png', { type: 'image/png' });
        const decodedText = await scanner.scanFile(fileLike);
        if (decodedText && typeof decodedText === 'string' && decodedText.trim().length > 0) {
          return decodedText;
        }
      } catch (scanErr) {
        capturedErrors.push('html5: ' + serializeUnknownError(scanErr));
      }
    }
    return null;
  } finally {
    try {
      scanner?.clear();
    } catch {
      // ignore cleanup
    }
  }
};

const tryDecodeWithJsQr = (imageDataList: ImageData[], capturedErrors: string[]): string | null => {
  for (const imageData of imageDataList) {
    try {
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });
      if (code && code.data && code.data.trim().length > 0) {
        return code.data;
      }
    } catch (err) {
      capturedErrors.push('jsqr: ' + serializeUnknownError(err));
    }
  }
  return null;
};

const decodeQrFromFileRobust = async (
  file: File,
  diagnosticsRef: { html5: string[]; jsqr: string[] }
): Promise<string> => {
  const img = await loadImageFromFile(file);
  const originalMax = Math.max(img.width, img.height, 1);
  const candidateSizes = Array.from(
    new Set(
      [
        originalMax,
        1200,
        900,
        1600,
        640,
        2000
      ].map((s) => Math.max(200, Math.min(2600, s)))
    )
  ).sort((a, b) => b - a);

  const imageDataList: ImageData[] = [];
  for (const size of candidateSizes) {
    for (const pad of [0, 0.08, 0.16]) {
      try {
        imageDataList.push(extractImageData(img, size, pad));
      } catch {
        // skip variant
      }
    }
  }

  const html5Errors: string[] = [];
  const html5Result = await tryDecodeWithHtml5Qr(imageDataList, html5Errors);
  diagnosticsRef.html5 = html5Errors;
  if (html5Result) return html5Result;

  const jsqrErrors: string[] = [];
  const jsQRResult = tryDecodeWithJsQr(imageDataList, jsqrErrors);
  diagnosticsRef.jsqr = jsqrErrors;
  if (jsQRResult) return jsQRResult;

  const firstHtml = html5Errors[0];
  const firstJs = jsqrErrors[0];
  const note =
    firstHtml || firstJs
      ? ` (html5-qr: ${serializeUnknownError(firstHtml || '')} · jsQR: ${serializeUnknownError(
          firstJs || ''
        )})`
      : '';
  throw new Error(
    'Ningun decoder pudo leer el QR. Asegurate de que el codigo tenga borde blanco, este enfocado y no este cortado.' +
      note
  );
};

const sanitizePasswordsForQR = (entries: PasswordEntry[]): QRTransferPassword[] => {
  return entries.map((entry) => ({
    site: entry.site,
    username: entry.username,
    password: entry.password,
    category: entry.category || 'Uncategorized'
  }));
};

const ImportExportModal: React.FC<ImportExportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  onExportSuccess,
  passwords,
  variant = 'auto',
  initialMode = null
}) => {
  const [mode, setMode] = useState<Mode>('select');
  const [backupPattern, setBackupPattern] = useState<number[] | null>(null);
  const [backupConfirmPattern, setBackupConfirmPattern] = useState<number[] | null>(null);
  const [backupConfirmStep, setBackupConfirmStep] = useState(false);
  const [backupPatternReset, setBackupPatternReset] = useState(0);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPasswordIds, setSelectedPasswordIds] = useState<string[]>([]);
  const [qrSharePattern, setQrSharePattern] = useState<number[] | null>(null);
  const [qrSharePatternReset, setQrSharePatternReset] = useState(0);
  const [shareQRStep, setShareQRStep] = useState<1 | 2 | 3>(1);
  const [shareQRAnimKey, setShareQRAnimKey] = useState(0);
  const [generatedQRData, setGeneratedQRData] = useState('');
  const [generatedQRChunks, setGeneratedQRChunks] = useState<string[]>([]);
  const [currentQRChunkIndex, setCurrentQRChunkIndex] = useState(0);
  const [pendingQRPayload, setPendingQRPayload] = useState<QRSharePayload | null>(null);
  const [qrImportPattern, setQrImportPattern] = useState<number[] | null>(null);
  const [qrImportPatternReset, setQrImportPatternReset] = useState(0);
  const [scannedPasswords, setScannedPasswords] = useState<PasswordEntry[]>([]);
  const [scanSource, setScanSource] = useState<ScanSource>(null);
  const [selectedImageName, setSelectedImageName] = useState('');
  const [availableCameras, setAvailableCameras] = useState<{ id: string; label: string }[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [receivedChunks, setReceivedChunks] = useState<ReceivedChunksMap>({});
  const [activeTransferId, setActiveTransferId] = useState<string | null>(null);
  const [scannerRestartKey, setScannerRestartKey] = useState(0);
  const [scanQRStep, setScanQRStep] = useState<1 | 2 | 3>(1);
  const [scanQRAnimKey, setScanQRAnimKey] = useState(0);
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [importAnimKey, setImportAnimKey] = useState(0);
  const [previewImportedPasswords, setPreviewImportedPasswords] = useState<PasswordEntry[] | null>(null);
  const [importPattern, setImportPattern] = useState<number[] | null>(null);
  const [importPatternReset, setImportPatternReset] = useState(0);
  const [patternError, setPatternError] = useState<string>('');
  const vaultFileInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const qrCodeContainerRef = useRef<HTMLDivElement>(null);
  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const isScannerRunningRef = useRef(false);
  const isScanLockedRef = useRef(false);
  const scanQRAutoDecryptGuardRef = useRef<string>('');
  const shareQRAutoGenerateGuardRef = useRef<string>('');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (patternError) {
      const t = setTimeout(() => setPatternError(''), 1200);
      return () => clearTimeout(t);
    }
  }, [patternError]);

  useEffect(() => {
    if (!isOpen) return;
    if (initialMode) {
      setMode(initialMode);
    } else {
      setMode('select');
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (!isOpen) return;
    const node = scrollContainerRef.current;
    const run = () => {
      if (node) {
        try {
          node.scrollTop = 0;
          node.scrollTo?.({ top: 0, behavior: 'instant' as ScrollBehavior });
        } catch {
          /* ignore old browsers */
        }
      }
      try {
        window.scrollTo?.({ top: 0, behavior: 'instant' as ScrollBehavior });
      } catch {
        /* ignore */
      }
    };
    run();
    const t = setTimeout(run, 0);
    const t2 = setTimeout(run, 60);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [isOpen, mode, scanQRStep, shareQRStep]);

  const [lastImportMode, setLastImportMode] = useState<ImportMode>(() => {
    const saved = localStorage.getItem('vault_last_import_mode');
    return (saved as ImportMode) || 'merge';
  });

  const stopQRScanner = useCallback(async () => {
    setHasTorch(false);
    setTorchOn(false);
    const scanner = qrScannerRef.current;
    if (!scanner) return;

    try {
      if (isScannerRunningRef.current) {
        await scanner.stop();
      }
    } catch {
      // Ignore cleanup errors when the scanner is already stopped
    }

    try {
      scanner.clear();
    } catch {
      // Ignore cleanup errors when the scanner container is already cleared
    }

    qrScannerRef.current = null;
    isScannerRunningRef.current = false;
  }, []);

  const toggleTorch = useCallback(async () => {
    const scanner = qrScannerRef.current;
    if (!scanner || !isScannerRunningRef.current) return;
    try {
      const nextState = !torchOn;
      await scanner.applyVideoConstraints({
        advanced: [{ torch: nextState }]
      } as any);
      setTorchOn(nextState);
    } catch (err) {
      console.warn('[camera-diagnostic] Failed to toggle torch:', err);
    }
  }, [torchOn]);

  const resetQRImportState = useCallback(() => {
    isScanLockedRef.current = false;
    scanQRAutoDecryptGuardRef.current = '';
    setPendingQRPayload(null);
    setQrImportPattern(null);
    setQrImportPatternReset((k) => k + 1);
    setScannedPasswords([]);
    setScanSource(null);
    setSelectedImageName('');
    setReceivedChunks({});
    setActiveTransferId(null);
    setScanQRStep(1);
  }, []);

  const resetForm = useCallback(() => {
    setBackupPattern(null);
    setBackupConfirmPattern(null);
    setBackupConfirmStep(false);
    setBackupPatternReset((k) => k + 1);
    setError('');
    setSuccess('');
    setMode('select');
    setImportMode(lastImportMode);
    setSelectedFileName('');
    setSelectedPasswordIds([]);
    setQrSharePattern(null);
    setQrSharePatternReset((k) => k + 1);
    setShareQRStep(1);
    setGeneratedQRData('');
    setGeneratedQRChunks([]);
    setCurrentQRChunkIndex(0);
    shareQRAutoGenerateGuardRef.current = '';
    setImportPattern(null);
    setImportPatternReset((k) => k + 1);
    setPatternError('');
    resetQRImportState();
    removeQrImageWorkerElement();
  }, [lastImportMode, resetQRImportState]);

  const handleClose = useCallback(async () => {
    await stopQRScanner();
    resetForm();
    onClose();
  }, [onClose, resetForm, stopQRScanner]);

  const changeMode = async (nextMode: Mode) => {
    if (mode === 'scanQR' && nextMode !== 'scanQR') {
      await stopQRScanner();
    }

    setError('');
    setSuccess('');
    setPatternError('');
    setMode(nextMode);

    if (nextMode !== 'export') {
      setBackupPattern(null);
      setBackupConfirmPattern(null);
      setBackupConfirmStep(false);
      setBackupPatternReset((k) => k + 1);
    }

    if (nextMode !== 'import') {
      setImportStep(1);
      setImportAnimKey((k) => k + 1);
      setPreviewImportedPasswords(null);
      setSelectedFileName('');
      setSelectedFile(null);
      setImportPattern(null);
      setImportPatternReset((k) => k + 1);
      if (vaultFileInputRef.current) {
        vaultFileInputRef.current.value = '';
      }
    }

    if (nextMode !== 'shareQR') {
      setSelectedPasswordIds([]);
      setQrSharePattern(null);
      setQrSharePatternReset((k) => k + 1);
      setShareQRStep(1);
      setGeneratedQRData('');
      setGeneratedQRChunks([]);
      setCurrentQRChunkIndex(0);
      shareQRAutoGenerateGuardRef.current = '';
    }

    if (nextMode !== 'scanQR') {
      resetQRImportState();
      if (imageFileInputRef.current) {
        imageFileInputRef.current.value = '';
      }
    }
  };

  const handleExportBackupPattern = (pattern: number[]) => {
    if (!backupConfirmStep) {
      setBackupPattern(pattern);
      setBackupConfirmStep(true);
      setBackupPatternReset((k) => k + 1);
      setSuccess('Patrón guardado. Dibuja el mismo patrón para confirmar.');
    } else {
      if (JSON.stringify(backupPattern) !== JSON.stringify(pattern)) {
        setPatternError('Los patrones no coinciden.');
        setBackupConfirmStep(false);
        setBackupPattern(null);
        setBackupConfirmPattern(null);
        setBackupPatternReset((k) => k + 1);
        setError('');
        return;
      }
      setBackupConfirmPattern(pattern);
      setPatternError('');
      void handleExport();
    }
  };

  const handleExport = async () => {
    if (!backupPattern || !backupConfirmPattern) {
      setError('Dibuja y confirma el patrón de protección del respaldo');
      return;
    }

    if (JSON.stringify(backupPattern) !== JSON.stringify(backupConfirmPattern)) {
      setError('Los patrones no coinciden');
      setBackupConfirmStep(false);
      setBackupPattern(null);
      setBackupConfirmPattern(null);
      setBackupPatternReset((k) => k + 1);
      return;
    }

    try {
      const exportData = {
        version: '1.0',
        timestamp: Date.now(),
        passwords: passwords,
        metadata: {
          totalPasswords: passwords.length,
          categories: Array.from(new Set(passwords.map(p => p.category))),
          exportDate: new Date().toISOString()
        }
      };

      const jsonData = JSON.stringify(exportData);
      const encrypted = EncryptionService.encrypt(jsonData, patternToString(backupPattern));

      const fileName = `respaldo-boveda-${new Date().toISOString().split('T')[0]}.vault`;
      const blob = new Blob([JSON.stringify(encrypted)], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess('Archivo exportado exitosamente');
      if (onExportSuccess) onExportSuccess();
      setTimeout(() => {
        void handleClose();
      }, 2000);
    } catch (error) {
      setError('Error al exportar: ' + (error as Error).message);
    }
  };

  const handleGenerateQR = () => {
    const selectedPasswords = passwords.filter((password) =>
      selectedPasswordIds.includes(password.id)
    );

    if (selectedPasswords.length === 0) {
      setError('Selecciona al menos una contraseña para enviar');
      return false;
    }

    if (!qrSharePattern) {
      setError('Dibuja el patrón de desbloqueo de este dispositivo para generar el QR');
      return false;
    }

    try {
      const encrypted = EncryptionService.encrypt(
        JSON.stringify({ passwords: sanitizePasswordsForQR(selectedPasswords) }),
        patternToString(qrSharePattern)
      );

      const encryptedStr = JSON.stringify(encrypted);
      const b64Encrypted = utf8ToBase64Safe(encryptedStr);
      const transferId = generateTransferId();

      const provisionalChunkSize = estimateChunkSizeForEncryptedChunk(transferId, 2);
      const provisionalChunks = splitStringIntoChunks(b64Encrypted, provisionalChunkSize);
      const finalChunkSize = estimateChunkSizeForEncryptedChunk(transferId, provisionalChunks.length);
      const finalChunks = splitStringIntoChunks(b64Encrypted, finalChunkSize);

      const timestamp = Date.now();

      if (finalChunks.length === 1) {
        const payload: QRSharePayloadV2 = {
          app: 'SecurePass',
          version: '2.0',
          type: 'password-share',
          timestamp,
          encrypted
        };
        const qrString = JSON.stringify(payload);
        const payloadSize = new TextEncoder().encode(qrString).length;
        if (payloadSize > MAX_QR_PAYLOAD_BYTES) {
          throw new Error(
            'Error interno al generar el QR (límite de tamaño excedido para 1 QR). Reduce ligeramente la selección y reinténtalo.'
          );
        }
        setGeneratedQRChunks([qrString]);
        setCurrentQRChunkIndex(0);
        setGeneratedQRData(qrString);
        setSuccess('QR generado. Escanéalo o impórtalo desde imagen en el otro dispositivo.');
        setError('');
        return true;
      }

      const qrStrings: string[] = [];
      finalChunks.forEach((chunkStr, idx) => {
        const payload: QRSharePayloadV3 = {
          app: 'SecurePass',
          version: '3.0',
          type: 'password-share',
          timestamp,
          transferId,
          chunkIndex: idx + 1,
          totalChunks: finalChunks.length,
          encryptedChunk: chunkStr
        };
        const qrString = JSON.stringify(payload);
        const payloadSize = new TextEncoder().encode(qrString).length;
        if (payloadSize > MAX_QR_PAYLOAD_BYTES) {
          throw new Error(
            'Error interno al fragmentar el QR (fragmento ' +
              (idx + 1) +
              ' excede el límite). Reduce ligeramente la selección y reinténtalo.'
          );
        }
        qrStrings.push(qrString);
      });

      setGeneratedQRChunks(qrStrings);
      setCurrentQRChunkIndex(0);
      setGeneratedQRData(qrStrings[0] || '');
      setSuccess(
        `Transferencia preparada: ${qrStrings.length} códigos QR. Muéstralos todos al otro dispositivo en orden.`
      );
      setError('');
      return true;
    } catch (error) {
      setGeneratedQRChunks([]);
      setCurrentQRChunkIndex(0);
      setGeneratedQRData('');
      setError('Error al generar el QR: ' + (error as Error).message);
      return false;
    }
  };

  const handleSaveQRImage = async () => {
    const qrSvg = qrCodeContainerRef.current?.querySelector('svg');
    if (!qrSvg || !generatedQRData) {
      setError('Genera el QR antes de guardarlo como imagen.');
      return;
    }

    try {
      const logicalSize = 300;
      if (!qrSvg.getAttribute('width')) qrSvg.setAttribute('width', String(logicalSize));
      if (!qrSvg.getAttribute('height')) qrSvg.setAttribute('height', String(logicalSize));
      if (!qrSvg.getAttribute('viewBox')) qrSvg.setAttribute('viewBox', `0 0 ${logicalSize} ${logicalSize}`);
      if (!qrSvg.getAttribute('xmlns')) qrSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

      const svgMarkup = new XMLSerializer().serializeToString(qrSvg);
      const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      const canvasSize = 1440;
      const paddingPx = 120;
      const innerSize = canvasSize - paddingPx * 2;

      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = canvasSize;
          canvas.height = canvasSize;
          const context = canvas.getContext('2d');

          if (!context) {
            URL.revokeObjectURL(svgUrl);
            setError('No se pudo preparar la imagen del QR para guardarla.');
            return;
          }

          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.imageSmoothingEnabled = false;
          context.drawImage(image, paddingPx, paddingPx, innerSize, innerSize);

          const pngUrl = canvas.toDataURL('image/png');
          const link = document.createElement('a');
          link.href = pngUrl;
          link.download = `securepass-qr-${new Date().toISOString().split('T')[0]}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(svgUrl);
          setSuccess('QR guardado como imagen PNG.');
          setError('');
        } catch (drawError) {
          console.error('[handleSaveQRImage] Error al dibujar QR en canvas:', drawError);
          URL.revokeObjectURL(svgUrl);
          setError('No se pudo guardar el QR como imagen: ' + (drawError as Error).message);
        }
      };

      image.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        console.error('[handleSaveQRImage] Fallo onload del blob SVG (width/height intrínseco no detectado).');
        setError('No se pudo guardar el QR como imagen.');
      };

      image.src = svgUrl;
    } catch (error) {
      console.error('[handleSaveQRImage] Error al guardar QR PNG:', error);
      setError('Error al guardar el QR: ' + (error as Error).message);
    }
  };

  const handleParsedQRPayload = useCallback(async (decodedText: string, source: Exclude<ScanSource, null>) => {
    try {
      const parsedPayload = JSON.parse(decodedText);

      if (!isValidQRPayload(parsedPayload)) {
        throw new Error('El QR no pertenece a una transferencia válida de SecurePass');
      }

      setError('');
      setScannedPasswords([]);

      if (parsedPayload.version === '2.0') {
        if (source === 'camera') {
          await stopQRScanner();
        }
        isScanLockedRef.current = true;
        setPendingQRPayload(parsedPayload);
        setQrImportPattern(null);
        setQrImportPatternReset((k) => k + 1);
        setScanSource(source);
        setSuccess('QR leído correctamente. Dibuja el patrón del dispositivo origen para descifrar.');
        return;
      }

      const v3 = parsedPayload as QRSharePayloadV3;

      if (v3.totalChunks === 1) {
        if (source === 'camera') {
          await stopQRScanner();
        }
        isScanLockedRef.current = true;
        setPendingQRPayload(v3);
        setQrImportPattern(null);
        setQrImportPatternReset((k) => k + 1);
        setScanSource(source);
        setSuccess('QR leído correctamente. Dibuja el patrón del dispositivo origen para descifrar.');
        return;
      }

      if (source === 'camera') {
        isScanLockedRef.current = true;
      }
      setScanSource(source);

      let currentTransferId = activeTransferId;
      let updatedChunks = { ...receivedChunks };

      if (!currentTransferId) {
        currentTransferId = v3.transferId;
        setActiveTransferId(currentTransferId);
      } else if (currentTransferId !== v3.transferId) {
        setError('Se detectó un QR de otra transferencia. Usa ↺ Reiniciar lectura QR para comenzar una nueva.');
        return;
      }

      const existing = updatedChunks[currentTransferId];
      if (!existing) {
        updatedChunks[currentTransferId] = {
          totalChunks: v3.totalChunks,
          chunks: {}
        };
      } else if (existing.totalChunks !== v3.totalChunks) {
        setError('Inconsistencia en la transferencia (totalChunks distinto). Reinicia la lectura.');
        return;
      }

      if (updatedChunks[currentTransferId].chunks[v3.chunkIndex]) {
        setSuccess(`QR ${v3.chunkIndex}/${v3.totalChunks} ya estaba recibido. Escanea uno diferente.`);
      } else {
        updatedChunks[currentTransferId] = {
          ...updatedChunks[currentTransferId],
          chunks: {
            ...updatedChunks[currentTransferId].chunks,
            [v3.chunkIndex]: v3.encryptedChunk
          }
        };
        setReceivedChunks(updatedChunks);
        const receivedCount = Object.keys(updatedChunks[currentTransferId].chunks).length;
        if (receivedCount === v3.totalChunks) {
          if (source === 'camera') {
            await stopQRScanner();
          }
          setPendingQRPayload({ ...v3 });
          setQrImportPattern(null);
          setQrImportPatternReset((k) => k + 1);
          setSuccess(
            `Transferencia completa (${v3.totalChunks} QR). Dibuja el patrón del dispositivo origen para descifrar.`
          );
        } else {
          setSuccess(
            `Recibido QR ${v3.chunkIndex}/${v3.totalChunks}. Faltan ${v3.totalChunks - receivedCount}.`
          );
          if (source === 'camera') {
            setTimeout(() => {
              isScanLockedRef.current = false;
            }, 900);
          }
        }
      }
    } catch (error) {
      setError('Error al leer el QR: ' + (error as Error).message);
    }
  }, [stopQRScanner, activeTransferId, receivedChunks]);

  const handleDecryptScannedQR = async (): Promise<boolean> => {
    if (!pendingQRPayload) {
      const transferReady =
        activeTransferId &&
        receivedChunks[activeTransferId] &&
        Object.keys(receivedChunks[activeTransferId].chunks).length ===
          receivedChunks[activeTransferId].totalChunks;
      if (!transferReady) {
        setError('Primero debes escanear TODOS los códigos QR de la transferencia.');
        return false;
      }
    }

    if (!qrImportPattern) {
      setError('Dibuja el patrón de desbloqueo del dispositivo origen');
      return false;
    }

    try {
      let encryptedData: EncryptedData;

      if (pendingQRPayload && pendingQRPayload.version === '2.0') {
        encryptedData = pendingQRPayload.encrypted;
      } else {
        const transferId =
          (pendingQRPayload && (pendingQRPayload as QRSharePayloadV3).transferId) || activeTransferId;
        if (!transferId) {
          throw new Error('No hay una transferencia QR activa. Reinicia la lectura.');
        }
        const transfer = receivedChunks[transferId];
        if (!transfer) {
          throw new Error('No hay fragmentos recibidos. Escanea los códigos QR.');
        }
        const receivedKeys = Object.keys(transfer.chunks);
        const receivedCount = receivedKeys.length;
        if (receivedCount !== transfer.totalChunks) {
          setError(
            `Todavía faltan ${transfer.totalChunks - receivedCount} QR de ${transfer.totalChunks} totales.`
          );
          return false;
        }
        const sortedIndexes = receivedKeys
          .map((k) => parseInt(k, 10))
          .sort((a, b) => a - b);
        const joinedB64 = sortedIndexes
          .map((idx) => transfer.chunks[idx])
          .join('');
        let joinedEncryptedStr: string;
        try {
          joinedEncryptedStr = base64SafeToUtf8(joinedB64);
        } catch {
          throw new Error('No se pudo decodificar el contenido base64 de los QRs. Reinicia la lectura.');
        }
        let parsedEncrypted: EncryptedData;
        try {
          parsedEncrypted = JSON.parse(joinedEncryptedStr);
        } catch {
          throw new Error('No se pudo recomponer el contenido cifrado. Reinicia la lectura de QRs.');
        }
        if (
          !parsedEncrypted ||
          typeof parsedEncrypted.data !== 'string' ||
          typeof parsedEncrypted.iv !== 'string' ||
          typeof parsedEncrypted.salt !== 'string'
        ) {
          throw new Error('Contenido cifrado corrupto en la transferencia QR.');
        }
        encryptedData = parsedEncrypted;
      }

      const decryptedJson = EncryptionService.decrypt(
        encryptedData,
        patternToString(qrImportPattern)
      );
      const parsedData = JSON.parse(decryptedJson);

      if (!parsedData.passwords || !Array.isArray(parsedData.passwords)) {
        throw new Error('El contenido del QR no tiene un formato válido');
      }

      const importedPasswords = normalizePasswords(parsedData.passwords);

      setScannedPasswords(importedPasswords);
      setSuccess('Contraseñas descifradas correctamente. Revisa la vista previa antes de importar.');
      setError('');
      return true;
    } catch {
      setScannedPasswords([]);
      setError('Patrón de desbloqueo incorrecto o contenido QR inválido. No se importó ninguna contraseña.');
      return false;
    }
  };

  const handleImportFromQR = async () => {
    if (scannedPasswords.length === 0) {
      setError('Todavía no hay contraseñas descifradas para importar');
      return;
    }

    localStorage.setItem('vault_last_import_mode', importMode);
    setLastImportMode(importMode);

    onImport(scannedPasswords);
    setSuccess('Contraseñas importadas exitosamente desde el QR');
    setTimeout(() => {
      void handleClose();
    }, 1500);
  };

  const handleScanQRBack = () => {
    setError('');
    if (scanQRStep === 1) {
      void changeMode('select');
      return;
    }
    if (scanQRStep === 2) {
      setScanQRStep(1);
      setScanQRAnimKey((k) => k + 1);
      return;
    }
    if (scanQRStep === 3) {
      setScanQRStep(2);
      setScanQRAnimKey((k) => k + 1);
    }
  };

  const handleScanQRNext = async () => {
    setError('');
    const readySingle = !!pendingQRPayload;
    const multi = !!activeTransferId && !!receivedChunks[activeTransferId];
    const readyMulti =
      multi &&
      Object.keys(receivedChunks[activeTransferId].chunks).length ===
        receivedChunks[activeTransferId].totalChunks;
    const transferReady = readySingle || readyMulti;

    if (scanQRStep === 1) {
      if (!transferReady) {
        const totalQRs = multi ? receivedChunks[activeTransferId!].totalChunks : 1;
        const receivedQRs = multi
          ? Object.keys(receivedChunks[activeTransferId!].chunks).length
          : pendingQRPayload
          ? 1
          : 0;
        setError(
          `Faltan QRs por leer: tienes ${receivedQRs} de ${totalQRs}. Completa la lectura antes de avanzar.`
        );
        return;
      }
      setScanQRStep(2);
      setScanQRAnimKey((k) => k + 1);
      return;
    }

    if (scanQRStep === 2) {
      if (!transferReady) {
        setError('La transferencia no está completa. Vuelve al paso 1 y lee todos los QRs.');
        return;
      }
      if (!qrImportPattern || qrImportPattern.length < 4) {
        setError('Dibuja el patrón de desbloqueo antes de continuar.');
        return;
      }

      const ok = await handleDecryptScannedQR();
      if (!ok || scannedPasswords.length === 0) {
        return;
      }
      setScanQRStep(3);
      setScanQRAnimKey((k) => k + 1);
      return;
    }

    if (scanQRStep === 3) {
      await handleImportFromQR();
    }
  };

  const handleImportBack = () => {
    setError('');
    if (importStep === 1) {
      void changeMode('select');
      return;
    }
    if (importStep === 2) {
      setImportStep(1);
      setImportAnimKey((k) => k + 1);
      return;
    }
    if (importStep === 3) {
      setImportStep(2);
      setImportAnimKey((k) => k + 1);
    }
  };

  const handleImportNext = async () => {
    setError('');
    if (importStep === 1) {
      if (!selectedFile) {
        setError('Selecciona un archivo .vault antes de continuar.');
        return;
      }
      setImportStep(2);
      setImportAnimKey((k) => k + 1);
      return;
    }
    if (importStep === 2) {
      if (!importPattern || importPattern.length < 4) {
        setError('Dibuja el patrón de desbloqueo antes de continuar.');
        return;
      }
      if (!selectedFile) {
        setError('Selecciona un archivo .vault válido.');
        return;
      }
      try {
        const text = await selectedFile.text();
        const encrypted = JSON.parse(text);
        const decryptedJson = EncryptionService.decrypt(encrypted, patternToString(importPattern));
        const importData = JSON.parse(decryptedJson);
        if (!importData.passwords || !Array.isArray(importData.passwords)) {
          throw new Error('Formato de archivo inválido');
        }
        const normalized = normalizePasswords(importData.passwords);
        setPreviewImportedPasswords(normalized);
        setSuccess(
          `Archivo válido. Se van a restaurar ${normalized.length} contraseña${normalized.length === 1 ? '' : 's'}.`
        );
      } catch (err) {
        setError('Error al leer el archivo o patrón incorrecto: ' + (err as Error).message);
        return;
      }
      setImportStep(3);
      setImportAnimKey((k) => k + 1);
      return;
    }
    if (importStep === 3) {
      if (!previewImportedPasswords || previewImportedPasswords.length === 0) {
        setError('No hay contraseñas listas para importar. Vuelve al paso 2.');
        return;
      }
      try {
        localStorage.setItem('vault_last_import_mode', importMode);
        setLastImportMode(importMode);
        onImport(previewImportedPasswords);
        setSuccess('Archivo importado exitosamente');
        setTimeout(() => {
          void handleClose();
        }, 2000);
      } catch (err) {
        setError('Error al importar: ' + (err as Error).message);
      }
    }
  };

  const handleVaultFileSelect = () => {
    vaultFileInputRef.current?.click();
  };

  const handleImageFileSelect = () => {
    imageFileInputRef.current?.click();
  };

  const handleStartCameraScan = async () => {
    await stopQRScanner();
    resetQRImportState();
    if (imageFileInputRef.current) {
      imageFileInputRef.current.value = '';
    }
    setAvailableCameras([]);
    setSelectedCameraId('');
    setSuccess('Abriendo cámara para escanear el QR...');
    setError('');
    setScanSource('camera');
    setScannerRestartKey((current) => current + 1);
  };

  const handleChangeCamera = async (newCameraId: string) => {
    if (newCameraId === selectedCameraId) return;
    setSelectedCameraId(newCameraId);
    setHasTorch(false);
    setTorchOn(false);
    await stopQRScanner();
    isScanLockedRef.current = false;
    setSuccess(`Cambiando a cámara: ${availableCameras.find((c) => c.id === newCameraId)?.label || 'Seleccionada'}…`);
    setError('');
    setScannerRestartKey((k) => k + 1);
  };

  const handleToggleFrontBack = async () => {
    setSelectedCameraId('');
    setHasTorch(false);
    setTorchOn(false);
    await stopQRScanner();
    isScanLockedRef.current = false;
    setSuccess('Cambiando lente (frontal/trasera)…');
    setError('');
    setScannerRestartKey((k) => k + 1);
  };

  const handleRestartQRScan = async () => {
    if (scanSource === 'camera') {
      await handleStartCameraScan();
      return;
    }

    await stopQRScanner();
    resetQRImportState();
    if (imageFileInputRef.current) {
      imageFileInputRef.current.value = '';
    }
    setSuccess('');
    setError('');
  };

  const handleImageSelection = async (file: File | null) => {
    if (!file) return;

    await stopQRScanner();
    resetQRImportState();
    setSelectedImageName(file.name);
    setSuccess('Procesando imagen para leer el QR...');
    setError('');

    try {
      const diagnostics: { html5: string[]; jsqr: string[] } = { html5: [], jsqr: [] };
      ensureQrImageWorkerElement();
      const decodedText = await decodeQrFromFileRobust(file, diagnostics);
      if (diagnostics.html5.length || diagnostics.jsqr.length) {
        console.debug('[handleImageSelection] Diagnósticos decodificación:', diagnostics);
      }
      await handleParsedQRPayload(decodedText, 'image');
    } catch (error) {
      console.error('[handleImageSelection] Falló decodificación QR desde imagen:', error);
      try {
        qrScannerRef.current?.clear();
      } catch {
        // Ignore cleanup errors after a failed scan
      }
      qrScannerRef.current = null;
      const message = serializeUnknownError(error);
      const userMessage = message.includes('Ningun decoder pudo leer')
        ? message
        : QR_IMAGE_ERROR_MESSAGE + ' (Detalles: ' + message + ')';
      setError(userMessage);
      setSuccess('');
    }
  };

  const togglePasswordSelection = (id: string) => {
    setSelectedPasswordIds((current) =>
      current.includes(id)
        ? current.filter((passwordId) => passwordId !== id)
        : [...current, id]
    );
  };

  useEffect(() => {
    if (!isOpen || mode !== 'scanQR' || scanSource !== 'camera') {
      return;
    }

    let cancelled = false;

    const startScanner = async () => {
      await stopQRScanner();
      isScanLockedRef.current = false;

      // Track provisional que liberamos ANTES de entregar el flujo a html5-qrcode.
      // Si el navegador/driver se cuelga al pedir facingMode: 'environment' (bug conocido
      // en html5-qrcode 2.3.x con cámaras únicas), al menos nosotros cerramos los tracks.
      let provisionalStream: MediaStream | null = null;
      const killProvisionalStream = () => {
        if (!provisionalStream) return;
        try {
          provisionalStream.getTracks().forEach((t) => {
            try { t.stop(); } catch { /* ignore */ }
          });
        } catch { /* ignore */ }
        provisionalStream = null;
      };

      try {
        // 🧪 Diagnóstico de permisos de cámara: pruebo getUserMedia DIRECTAMENTE
        // (sin pasar por html5-qrcode) para aislar el fallo.
        try {
          if (
            typeof navigator !== 'undefined' &&
            navigator.mediaDevices &&
            typeof navigator.mediaDevices.getUserMedia === 'function'
          ) {
            // eslint-disable-next-line no-console
            console.log('[camera-diagnostic] solicitando permiso getUserMedia({video:true}) DIRECTO …');
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            // eslint-disable-next-line no-console
            console.log('[camera-diagnostic] getUserMedia OK → tracks=', stream.getTracks());
            stream.getTracks().forEach((track) => {
              // eslint-disable-next-line no-console
              console.log('[camera-diagnostic]   stop track:', track.kind, track.label, track.readyState);
              track.stop();
            });
          } else {
            // eslint-disable-next-line no-console
            console.error(
              '[camera-diagnostic] navigator.mediaDevices.getUserMedia NO EXISTE. Seguridad? HTTP? SecureContext=false? SecureContext=',
              typeof window !== 'undefined' ? window.isSecureContext : 'N/A'
            );
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[camera-diagnostic] getUserMedia DIRECTO falló:', err);
        }

        // 🧪 Esperamos 1 ciclo de pintura React para que el div condicional
        // id="securepass-qr-reader" exista y tenga medidas.
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          await new Promise<void>((r) => window.requestAnimationFrame(() => r()));
        }
        await new Promise<void>((r) => setTimeout(r, 50));

        // 🧪 Diagnóstico del elemento del visor
        const qrElement = document.getElementById(QR_READER_ELEMENT_ID);
        // eslint-disable-next-line no-console
        console.log(
          '[camera-diagnostic] DOM elemento visor QR:',
          qrElement
            ? `OK — ${qrElement.offsetWidth}×${qrElement.offsetHeight}, visible=${
                qrElement.offsetWidth > 0 && qrElement.offsetHeight > 0
              }`
            : 'NO EXISTE AÚN EN EL DOM'
        );

        if (!qrElement || qrElement.offsetWidth === 0 || qrElement.offsetHeight === 0) {
          // eslint-disable-next-line no-console
          console.warn(
            '[camera-diagnostic] el visor QR no está listo. Cancelando scanner.start para evitar fallo html5-qrcode.'
          );
          throw new DOMException(
            'El contenedor del escáner QR aún no está disponible.',
            'NotFoundError'
          );
        }

        const scanner = new Html5Qrcode(QR_READER_ELEMENT_ID);
        qrScannerRef.current = scanner;

        // 🧪 Wrapper scanner.start CON TIMEOUT de 4s.
        // html5-qrcode a veces se cuelga "para siempre" cuando el driver no soporta
        // facingMode: 'environment' en una cámara única. Con Promise.race evitamos
        // dejar el usuario bloqueado sin feedback.
        const tryStartWithTimeout = async (
          config: object,
          label: string,
          timeoutMs = 4000
        ): Promise<void> => {
          // eslint-disable-next-line no-console
          console.log(`[camera-diagnostic] scanner.start() "${label}" → config=`, config);

          // 🛟 Stream provisional NUESTRO (antes que html5-qrcode haga el suyo)
          // Para garantizar que cerramos hardware si el timeout dispara.
          let streamBefore: MediaStream | null = null;
          try {
            if (
              typeof navigator !== 'undefined' &&
              navigator.mediaDevices?.getUserMedia
            ) {
              streamBefore = await navigator.mediaDevices.getUserMedia(
                config as MediaStreamConstraints
              );
              streamBefore.getTracks().forEach((t) => t.stop());
              streamBefore = null;
              // eslint-disable-next-line no-console
              console.log(
                `[camera-diagnostic]   (our own test-call passed → hardware libre)`
              );
            }
          } catch (preErr) {
            // eslint-disable-next-line no-console
            console.warn(
              `[camera-diagnostic]   nuestra llamada previa falló → probablemente la constraint no se pueda pedir (OK, html5-qrcode también lo hará).`,
              preErr
            );
          } finally {
            if (streamBefore) {
              streamBefore.getTracks().forEach((t) => {
                try { t.stop(); } catch { /* ignore */ }
              });
              streamBefore = null;
            }
          }

          const startPromise = scanner.start(
            config as Parameters<Html5Qrcode['start']>[0],
            {
              fps: 10,
              qrbox: { width: 220, height: 220 },
              aspectRatio: 1
            },
            async (decodedText) => {
              if (cancelled || isScanLockedRef.current) return;
              isScanLockedRef.current = true;
              await handleParsedQRPayload(decodedText, 'camera');
            },
            () => {}
          );

          const timeoutPromise = new Promise<never>((_resolve, reject) => {
            const id = window.setTimeout(() => {
              window.clearTimeout(id);
              reject(
                Object.assign(new Error(`html5-qrcode scanner.start('${label}') no respondió en ${timeoutMs}ms. Forzando reintento.`), {
                  name: 'ScannerStartTimeoutError'
                })
              );
            }, timeoutMs);
          });

          await Promise.race([startPromise, timeoutPromise]);
        };

        type StartedMode = 'deviceId' | 'environment' | 'any';
        let started: StartedMode | null = null;

        try {
          if (selectedCameraId) {
            try {
              await tryStartWithTimeout(
                { deviceId: { exact: selectedCameraId } },
                `deviceId:${selectedCameraId.slice(0, 6)}…`,
                5000
              );
              started = 'deviceId';
            } catch (deviceErr) {
              const e2 = deviceErr as { name?: string; constraintName?: string };
              // eslint-disable-next-line no-console
              console.warn(
                `[camera-diagnostic] scanner.start deviceId="${selectedCameraId}" falló → name=${e2.name}. Volviendo a estrategia por defecto.`
              );
              // No propagamos: intentamos el flujo standard (environment → any)
            }
          }

          if (!started) {
            try {
              await tryStartWithTimeout({ facingMode: 'environment' }, 'environment', 4000);
              started = 'environment';
            } catch (startErr) {
              const err = startErr as { name?: string; message?: string; constraintName?: string };
              // eslint-disable-next-line no-console
              console.warn(
                `[camera-diagnostic] scanner.start facingMode=environment FALLÓ → name=${err.name}  constraint=${
                  (err as unknown as { constraintName?: string }).constraintName ?? 'N/A'
                }  message=${err.message ?? String(startErr)}`
              );

              const retryable =
                err.name === 'OverconstrainedError' ||
                err.name === 'NotFoundError' ||
                err.name === 'NotReadableError' ||
                err.name === 'ScannerStartTimeoutError' ||
                (err as { constraintName?: string }).constraintName === 'facingMode';

              if (retryable) {
                // 🛟 Antes de reintentar: limpieza DRACONIANA de tracks por si el driver
                // se quedó medio abierto tras el timeout o el fallo.
                killProvisionalStream();
                try {
                  const devs = await navigator.mediaDevices?.enumerateDevices?.();
                  // eslint-disable-next-line no-console
                  console.debug(
                    `[camera-diagnostic] enumerateDevices() antes del retry any-camera →`,
                    devs
                  );
                } catch { /* ignore */ }

                // eslint-disable-next-line no-console
                console.log('[camera-diagnostic] → reintento scanner.start SIN restricciones de facingMode');

                await tryStartWithTimeout({}, 'any-camera', 5000);
                started = 'any';
              } else {
                throw startErr;
              }
            }
          }
        } catch (outerErr) {
          if (!started) throw outerErr;
        }

        if (!started) {
          throw new Error('No se pudo iniciar ninguna estrategia de cámara (deviceId/environment/any).');
        }

        // eslint-disable-next-line no-console
        console.log(`[camera-diagnostic] ✅ scanner.start OK usando modo "${started}"`);
        isScannerRunningRef.current = true;
        setSuccess('Apunta la cámara al QR para continuar con la importación.');

        // 🔍 Detección de capacidades: linterna + cámaras disponibles
        try {
          // Intentar enumerar cámaras
          if (
            typeof navigator !== 'undefined' &&
            navigator.mediaDevices?.enumerateDevices
          ) {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices.filter((d) => d.kind === 'videoinput');
            setAvailableCameras(
              videoInputs.map((d, i) => ({
                id: d.deviceId,
                label: d.label || `Cámara ${i + 1}`
              }))
            );
            // eslint-disable-next-line no-console
            console.log(
              `[camera-diagnostic] Cámaras detectadas: ${videoInputs.length}`,
              videoInputs.map((d, i) => d.label || `Cámara ${i + 1}`)
            );
          }
        } catch (camErr) {
          console.warn('[camera-diagnostic] enumerateDevices falló (no crítico):', camErr);
        }

        try {
          // Intentar detectar soporte de linterna / torch
          let torchSupported = false;
          // Vías posibles para llegar al MediaStreamTrack activo según versión de html5-qrcode
          const scannerAny = qrScannerRef.current as unknown as {
            getRunningTrack?: () => MediaStreamTrack | undefined;
            getRunningTrackCamera?: () => MediaStreamTrack | undefined;
            _activeTrack?: MediaStreamTrack;
            _scanner?: { _activeTrack?: MediaStreamTrack };
          };
          const track: MediaStreamTrack | undefined =
            scannerAny?.getRunningTrack?.() ||
            scannerAny?.getRunningTrackCamera?.() ||
            scannerAny?._activeTrack ||
            scannerAny?._scanner?._activeTrack;
          if (track) {
            try {
              const caps = (track.getCapabilities?.() as { torch?: boolean }) || {};
              if (caps.torch === true) {
                torchSupported = true;
              }
            } catch { /* ignore */ }
          }
          setHasTorch(torchSupported);
          // eslint-disable-next-line no-console
          console.log(
            `[camera-diagnostic] Soporte de linterna: ${torchSupported ? 'SÍ' : 'NO'} (track detectado=${!!track})`
          );
        } catch (torchErr) {
          console.warn('[camera-diagnostic] Detección de torch falló (no crítico):', torchErr);
          setHasTorch(false);
        }
      } catch (err) {
        killProvisionalStream();
        const e = err as { name?: string; message?: string; constraintName?: string };
        // eslint-disable-next-line no-console
        console.error('[camera-diagnostic] fallo FINAL scanner.start html5-qrcode:', e);
        qrScannerRef.current = null;
        isScannerRunningRef.current = false;
        setSuccess('');

        const detalle =
          [e.name, (e as { constraintName?: string }).constraintName]
            .filter(Boolean)
            .join(' · ') || serializeUnknownError(err);

        if (e.name === 'ScannerStartTimeoutError') {
          setError(
            `El controlador de la cámara no respondió al pedir la configuración deseada. Reinicia la pestaña o usa "Cargar imagen QR". (Detalles: ${detalle})`
          );
        } else if (e.name === 'OverconstrainedError') {
          setError(
            `Tu dispositivo no tiene una cámara compatible con la configuración solicitada. Usa "Cargar imagen QR" para continuar. (Detalles: ${detalle})`
          );
        } else if (e.name === 'NotFoundError') {
          setError(
            `No se detectó ninguna cámara disponible en este equipo. Usa "Cargar imagen QR" para continuar. (Detalles: ${detalle})`
          );
        } else if (e.name === 'NotReadableError') {
          setError(
            `La cámara está siendo usada por otra aplicación (Zoom, Meet, Teams…). Ciérrala y vuelve a intentarlo o usa "Cargar imagen QR". (Detalles: ${detalle})`
          );
        } else {
          setError(
            `No se pudo abrir la cámara. Revisa los permisos o usa "Cargar imagen QR". (Detalles: ${detalle})`
          );
        }
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      void stopQRScanner();
    };
  }, [handleParsedQRPayload, isOpen, mode, scanSource, scannerRestartKey, selectedCameraId, stopQRScanner]);

  useEffect(() => {
    if (!isOpen || mode !== 'scanQR') {
      return;
    }

    const readySingle = !!pendingQRPayload;
    const multi = !!activeTransferId && !!receivedChunks[activeTransferId];
    const readyMulti =
      multi &&
      Object.keys(receivedChunks[activeTransferId].chunks).length ===
        receivedChunks[activeTransferId].totalChunks;
    const transferReady = readySingle || readyMulti;

    if (scanQRStep === 1) {
      if (!transferReady) return;
      const autoAdvance = setTimeout(() => {
        setScanQRStep(2);
        setScanQRAnimKey((k) => k + 1);
        setError('');
      }, 650);
      return () => clearTimeout(autoAdvance);
    }

    if (scanQRStep === 2) {
      if (!transferReady) return;
      if (!qrImportPattern || qrImportPattern.length < 4) return;
      if (scannedPasswords.length > 0) return;

      const guardKey =
        JSON.stringify(qrImportPattern) +
        '|' +
        (pendingQRPayload?.version === '3.0'
          ? `${(pendingQRPayload as QRSharePayloadV3).transferId}-${
              (pendingQRPayload as QRSharePayloadV3).chunkIndex
            }`
          : String(pendingQRPayload?.timestamp || '')) +
        '|' +
        (multi
          ? `${activeTransferId}-${
              receivedChunks[activeTransferId!].totalChunks
            }-${Object.keys(receivedChunks[activeTransferId!].chunks).length}`
          : 'single') +
        '|' +
        scanQRAnimKey;

      if (scanQRAutoDecryptGuardRef.current === guardKey) return;

      const t = setTimeout(async () => {
        if (scanQRAutoDecryptGuardRef.current === guardKey) return;
        scanQRAutoDecryptGuardRef.current = guardKey;
        const ok = await handleDecryptScannedQR();
        if (ok) {
          setScanQRStep(3);
          setScanQRAnimKey((k) => k + 1);
          setError('');
        }
      }, 480);

      return () => clearTimeout(t);
    }
  }, [
    activeTransferId,
    handleDecryptScannedQR,
    isOpen,
    mode,
    pendingQRPayload,
    qrImportPattern,
    receivedChunks,
    scanQRAnimKey,
    scanQRStep,
    scannedPasswords.length
  ]);

  useEffect(() => {
    if (!isOpen || mode !== 'shareQR') return;
    if (shareQRStep !== 2) return;
    if (!qrSharePattern || qrSharePattern.length < 4) return;
    if (generatedQRChunks.length > 0) return;

    const guardKey =
      JSON.stringify(qrSharePattern) +
      '|' +
      selectedPasswordIds.slice().sort().join(',') +
      '|' +
      passwords.length +
      '|' +
      qrSharePatternReset;

    if (shareQRAutoGenerateGuardRef.current === guardKey) return;

    const t = setTimeout(async () => {
      if (shareQRAutoGenerateGuardRef.current === guardKey) return;
      shareQRAutoGenerateGuardRef.current = guardKey;
      const ok = await handleGenerateQR();
      if (ok) {
        setShareQRStep(3);
        setError('');
      }
    }, 480);

    return () => clearTimeout(t);
  }, [
    generatedQRChunks.length,
    handleGenerateQR,
    isOpen,
    mode,
    passwords.length,
    qrSharePattern,
    qrSharePatternReset,
    selectedPasswordIds,
    shareQRStep
  ]);

  if (!isOpen) return null;

  const isQrFlow = mode === 'shareQR' || mode === 'scanQR';
  // Solamente el selector menú ('select') queda en modal centrado.
  // Cualquier operación real (export/import JSON · share/scan QR) ocupa 100% pantalla
  // para máxima densidad de información y experiencia similar en todos los flujos.
  const isFullscreenFlow =
    mode === 'export' || mode === 'import' || mode === 'shareQR' || mode === 'scanQR';
  const resolvedVariant: 'modal' | 'fullscreen' =
    variant === 'auto' ? (isFullscreenFlow ? 'fullscreen' : 'modal') : variant;

  const titleText =
    mode === 'select'
      ? 'Gestionar bóveda'
      : mode === 'export'
      ? 'Crear respaldo'
      : mode === 'import'
      ? 'Restaurar respaldo'
      : mode === 'shareQR'
      ? 'Enviar por QR'
      : 'Recibir por QR';

  const TitleHeader: React.FC<{ showCloseButton?: boolean }> = ({ showCloseButton = true }) => (
    <div className="flex items-center justify-between gap-3 flex-shrink-0">
      <h2 className={`font-bold flex items-center min-w-0 ${resolvedVariant === 'fullscreen' ? 'text-lg sm:text-xl' : 'text-2xl'}`}>
        <ImportExportIcon className={`flex-shrink-0 text-cyan-400 ${resolvedVariant === 'fullscreen' ? 'w-5 h-5 mr-1.5' : 'w-6 h-6 mr-2'}`} />
        <span className="truncate">{titleText}</span>
      </h2>
      {showCloseButton && (
        <button
          onClick={() => void handleClose()}
          className={`flex-shrink-0 inline-flex items-center justify-center rounded-md border border-gray-600 text-gray-300 hover:text-white hover:bg-gray-700 transition-colors ${resolvedVariant === 'fullscreen' ? 'w-8 h-8' : 'w-9 h-9'}`}
          aria-label="Cerrar"
          title="Cerrar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );

  const overlayOuter =
    resolvedVariant === 'fullscreen'
      ? 'fixed inset-0 z-50 bg-gray-900 text-gray-200 flex flex-col h-screen w-screen animate-in fade-in duration-150'
      : 'fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-6';
  const innerBody =
    resolvedVariant === 'fullscreen'
      ? `space-y-3 sm:space-y-4`
      : `bg-gray-800 rounded-lg shadow-xl p-6 w-full text-gray-200 animate-fade-in-up overflow-y-auto ${
          isQrFlow ? 'max-w-4xl max-h-[90vh]' : 'max-w-md max-h-[90vh]'
        }`;

  const contentModes = (
    <>
        {mode === 'select' && (
          <div className="space-y-5 sm:space-y-6">
            <p className="text-gray-400">
              Crea o restaura un respaldo, o transfiere contraseñas entre dispositivos.
            </p>

            {/* ===== SECCIÓN 1 — RESPALDOS JSON ===== */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Respaldos
                </p>
                <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                  {'{ }'}  JSON · Archivo
                </span>
              </div>
              <p className="text-xs text-gray-500 -mt-1">
                Copia de seguridad completa en archivo para guardar en la nube o PC.
              </p>
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => void changeMode('export')}
                  className="group w-full text-left px-3 sm:px-4 py-2.5 sm:py-3 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center min-w-0">
                      <span className="hidden sm:inline w-7 h-7 mr-3 inline-flex items-center justify-center rounded-md bg-cyan-500/20 text-cyan-100 border border-cyan-400/30 text-xs font-bold">
                        ⤓
                      </span>
                      Crear respaldo
                    </span>
                    <span className="hidden sm:inline-flex items-center text-[11px] text-cyan-100/80 font-normal">
                      Exporta JSON
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => void changeMode('import')}
                  className="group w-full text-left px-3 sm:px-4 py-2.5 sm:py-3 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors font-semibold border border-gray-600"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center min-w-0">
                      <span className="hidden sm:inline w-7 h-7 mr-3 inline-flex items-center justify-center rounded-md bg-gray-600/70 text-gray-200 border border-gray-500/40 text-xs font-bold">
                        ⤒
                      </span>
                      Restaurar respaldo
                    </span>
                    <span className="hidden sm:inline-flex items-center text-[11px] text-gray-300/80 font-normal">
                      Importa JSON
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* ===== SECCIÓN 2 — TRANSFERENCIA QR ===== */}
            <div className="space-y-2.5 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Transferencia entre dispositivos
                </p>
                <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 inline-block -mt-[1px]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 3a1 1 0 011-1zm7 0a1 1 0 01.707.293L7.707 6.293a1 1 0 11-1.414-1.414l3-3A1 1 0 0110 3zm-1 7a1 1 0 011-1h2v2H10a1 1 0 110-2zm-3 6a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H7a1 1 0 01-1-1v-3zm6-6a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-3zM17 10a1 1 0 011-1h.001 2.293l2.293-2.293a1 1 0 011.414 1.414l-3 3A1 1 0 0117 10z" clipRule="evenodd" />
                  </svg>
                  Escaneo QR · Cámara
                </span>
              </div>
              <p className="text-xs text-gray-500 -mt-1">
                De móvil a móvil usando la cámara. Ideal para pasar contraseñas sin salir de la app.
              </p>
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => void changeMode('shareQR')}
                  className="group w-full text-left px-3 sm:px-4 py-2.5 sm:py-3 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center min-w-0">
                      <span className="hidden sm:inline w-7 h-7 mr-3 inline-flex items-center justify-center rounded-md bg-cyan-500/20 text-cyan-100 border border-cyan-400/30 text-sm">
                        →
                      </span>
                      Enviar por QR
                    </span>
                    <span className="hidden sm:inline-flex items-center text-[11px] text-cyan-100/80 font-normal">
                      Genera códigos QR
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => void changeMode('scanQR')}
                  className="group w-full text-left px-3 sm:px-4 py-2.5 sm:py-3 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors font-semibold border border-gray-600"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center min-w-0">
                      <span className="hidden sm:inline w-7 h-7 mr-3 inline-flex items-center justify-center rounded-md bg-gray-600/70 text-gray-200 border border-gray-500/40 text-sm">
                        ←
                      </span>
                      Recibir por QR
                    </span>
                    <span className="hidden sm:inline-flex items-center text-[11px] text-gray-300/80 font-normal">
                      Usa la cámara
                    </span>
                  </div>
                </button>
              </div>
            </div>

            <button
              onClick={() => void handleClose()}
              className="w-full px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors mt-1"
            >
              Cancelar
            </button>
          </div>
        )}

        {mode === 'export' && (
          <div className="space-y-4">
            <p className="text-gray-400">
              Crea una copia encriptada de toda tu bóveda. Tendrás que confirmar el mismo patrón dos veces.
            </p>

            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-bold border border-cyan-500/30">
                    {backupConfirmStep ? 2 : 1}
                  </span>
                  <p className="text-sm font-semibold text-gray-200">
                    {backupConfirmStep ? 'Confirma el patrón' : 'Dibuja un patrón de protección'}
                  </p>
                </div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Paso {backupConfirmStep ? 2 : 1} de 2
                </span>
              </div>
              <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${backupConfirmStep ? 'bg-cyan-500 w-full' : 'bg-cyan-500/70 w-1/2'}`}
                />
              </div>
              <p className="text-xs text-gray-500">
                {backupConfirmStep
                  ? 'Dibuja exactamente el mismo patrón para confirmar.'
                  : 'Conecta al menos 4 puntos. Deberás recordarlo para restaurar este respaldo.'}
              </p>
              <div className="flex justify-center">
                <GesturePad
                  onPatternComplete={handleExportBackupPattern}
                  minPoints={4}
                  showError={!!patternError}
                  resetKey={backupPatternReset}
                />
              </div>
              <div className="flex flex-wrap gap-2 justify-center items-center min-h-[20px]">
                {backupPattern && !backupConfirmStep && (
                  <p className="text-xs text-green-400">✓ Patrón definido. Confírmalo dibujándolo de nuevo.</p>
                )}
                {backupConfirmStep && !backupConfirmPattern && (
                  <p className="text-xs text-cyan-400">Ya casi terminas: dibuja el mismo patrón una segunda vez.</p>
                )}
                {patternError && (
                  <p className="text-xs text-red-400">{patternError}</p>
                )}
              </div>
              {(backupPattern || backupConfirmPattern) && (
                <div className="flex justify-center pt-1">
                  <button
                    onClick={() => {
                      setBackupPattern(null);
                      setBackupConfirmPattern(null);
                      setBackupConfirmStep(false);
                      setBackupPatternReset((k) => k + 1);
                      setPatternError('');
                      setSuccess('');
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-gray-700/60 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-600/40"
                  >
                    ↺ Reiniciar patrones
                  </button>
                </div>
              )}
            </div>

            {error && <p className="text-red-400 text-sm pl-1">{error}</p>}
            {success && <p className="text-green-400 text-sm pl-1">{success}</p>}

            <div className="flex justify-between gap-3 pt-2">
              <button
                onClick={() => void changeMode('select')}
                className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors min-w-[120px]"
              >
                Atrás
              </button>
              <button
                onClick={() => void handleExport()}
                disabled={!backupPattern || !backupConfirmPattern}
                className="px-5 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed min-w-[160px]"
              >
                Crear respaldo
              </button>
            </div>
          </div>
        )}

        {mode === 'import' && (
          <div key={`import-${importAnimKey}`} className="space-y-3 sm:space-y-4">
            <div className="space-y-1">
              <p className="text-gray-400 text-sm">
                Restaura una copia de seguridad desde un archivo <code className="px-1 rounded bg-gray-700/60 text-cyan-300 text-xs">.vault</code> siguiendo este flujo guiado.
              </p>
            </div>

            <div className="pt-0.5 pb-1.5 sm:pt-1 sm:pb-2">
              <div className="max-w-[420px] mx-auto">
                <div className="flex items-start justify-between px-0.5 sm:px-1">
                  <div className="flex flex-col items-center gap-1 sm:gap-2 flex-1">
                    <div
                      className={`relative z-10 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-colors ${
                        importStep > 1
                          ? 'bg-cyan-600 border-cyan-500 text-white shadow-[0_0_0_2px_rgba(168,85,247,0.15)]'
                          : importStep === 1
                          ? 'bg-cyan-600 border-cyan-400 text-white ring-4 ring-cyan-500/20'
                          : 'bg-gray-800 border-gray-600 text-gray-500'
                      }`}
                    >
                      {importStep > 1 ? '✓' : '1'}
                    </div>
                    <div className="text-center">
                      <p
                        className={`text-[10px] sm:text-[11px] font-semibold leading-tight ${
                          importStep >= 1 ? 'text-gray-200' : 'text-gray-500'
                        }`}
                      >
                        Archivo
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 flex items-center pt-3 sm:pt-4 mx-0.5 sm:mx-1">
                    <div
                      className={`h-0.5 w-full rounded-full transition-colors ${
                        importStep > 1 ? 'bg-cyan-500' : 'bg-gray-700'
                      }`}
                    />
                  </div>

                  <div className="flex flex-col items-center gap-1 sm:gap-2 flex-1">
                    <div
                      className={`relative z-10 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-colors ${
                        importStep > 2
                          ? 'bg-cyan-600 border-cyan-500 text-white shadow-[0_0_0_2px_rgba(168,85,247,0.15)]'
                          : importStep === 2
                          ? 'bg-cyan-600 border-cyan-400 text-white ring-4 ring-cyan-500/20'
                          : 'bg-gray-800 border-gray-600 text-gray-500'
                      }`}
                    >
                      {importStep > 2 ? '✓' : '2'}
                    </div>
                    <div className="text-center">
                      <p
                        className={`text-[10px] sm:text-[11px] font-semibold leading-tight ${
                          importStep >= 2 ? 'text-gray-200' : 'text-gray-500'
                        }`}
                      >
                        Patrón
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 flex items-center pt-3 sm:pt-4 mx-0.5 sm:mx-1">
                    <div
                      className={`h-0.5 w-full rounded-full transition-colors ${
                        importStep > 2 ? 'bg-cyan-500' : 'bg-gray-700'
                      }`}
                    />
                  </div>

                  <div className="flex flex-col items-center gap-1 sm:gap-2 flex-1">
                    <div
                      className={`relative z-10 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-colors ${
                        importStep >= 3
                          ? 'bg-cyan-600 border-cyan-400 text-white ring-4 ring-cyan-500/20'
                          : 'bg-gray-800 border-gray-600 text-gray-500'
                      }`}
                    >
                      3
                    </div>
                    <div className="text-center">
                      <p
                        className={`text-[10px] sm:text-[11px] font-semibold leading-tight ${
                          importStep >= 3 ? 'text-gray-200' : 'text-gray-500'
                        }`}
                      >
                        Confirmar
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              {(() => {
                if (importStep === 1) {
                  return (
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4 space-y-3 sm:space-y-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-200">
                          Paso 1 — Selecciona el archivo
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Elige el archivo <code className="px-1 rounded bg-gray-800 text-cyan-300 text-[10px]">.vault</code> generado por SecurePass.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <button
                          onClick={handleVaultFileSelect}
                          className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 hover:bg-gray-600 transition-colors text-left"
                        >
                          {selectedFileName || 'Seleccionar archivo .vault...'}
                        </button>
                        <input
                          ref={vaultFileInputRef}
                          type="file"
                          accept=".vault,.json,.vault.json,application/json,application/octet-stream"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            if (f) {
                              setSelectedFile(f);
                              setSelectedFileName(f.name);
                              setTimeout(() => void handleImportNext(), 140);
                            } else {
                              setSelectedFile(null);
                              setSelectedFileName('');
                            }
                          }}
                          className="hidden"
                        />
                      </div>
                      {selectedFileName && (
                        <div className="flex items-start gap-3 text-sm rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2.5">
                          <div className="text-green-400 text-lg leading-none mt-0.5">✓</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-gray-100 font-medium">Archivo cargado</p>
                            <p className="text-gray-500 truncate mt-0.5">{selectedFileName}</p>
                          </div>
                        </div>
                      )}
                      {!selectedFileName && (
                        <p className="text-sm text-cyan-500 font-medium text-center pt-1">
                          Selecciona un archivo .vault para continuar.
                        </p>
                      )}
                    </div>
                  );
                }

                if (importStep === 2) {
                  return (
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4 space-y-3 sm:space-y-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-200">
                          Paso 2 — Patrón de desbloqueo del respaldo
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Dibuja el patrón con el que se protegió este archivo cuando se creó.
                        </p>
                      </div>
                      <div className="flex justify-center">
                        <GesturePad
                          onPatternComplete={(p) => {
                            setImportPattern(p);
                            setSuccess('Patrón capturado. Validando archivo...');
                            setTimeout(() => void handleImportNext(), 160);
                          }}
                          minPoints={4}
                          resetKey={importPatternReset}
                        />
                      </div>
                      {importPattern && (
                        <div className="space-y-2">
                          <p className="text-center text-xs text-green-400">✓ Patrón introducido.</p>
                          <div className="flex justify-center pt-1">
                            <button
                              onClick={() => {
                                setImportPattern(null);
                                setImportPatternReset((k) => k + 1);
                                setSuccess('');
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-gray-700/60 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-600/40"
                            >
                              ↺ Reiniciar patrón
                            </button>
                          </div>
                        </div>
                      )}
                      {!importPattern && (
                        <p className="text-sm text-cyan-500 font-medium text-center pt-1">
                          Dibuja el patrón del archivo para continuar.
                        </p>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4 space-y-3 sm:space-y-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-200">
                          Paso 3 — Confirma la restauración
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Elige cómo integrar estas contraseñas en tu bóveda local.
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-gray-500">
                        {previewImportedPasswords?.length ?? 0} contraseñas
                      </span>
                    </div>

                    <div className="space-y-2">
                      <label
                        className={`flex items-start gap-3 p-3 rounded-md border transition-colors cursor-pointer ${
                          importMode === 'merge'
                            ? 'border-cyan-500/60 bg-cyan-500/5'
                            : 'border-gray-600 bg-gray-800/40 hover:border-gray-500'
                        }`}
                      >
                        <input
                          type="radio"
                          value="merge"
                          checked={importMode === 'merge'}
                          onChange={(e) => setImportMode(e.target.value as ImportMode)}
                          className="mt-1 mr-1"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-200">
                            Agregar a las existentes
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Fusiona las nuevas contraseñas con las actuales. Se actualizarán aquellas con el mismo sitio y usuario.
                          </p>
                        </div>
                      </label>
                      <label
                        className={`flex items-start gap-3 p-3 rounded-md border transition-colors cursor-pointer ${
                          importMode === 'overwrite'
                            ? 'border-cyan-500/60 bg-cyan-500/5'
                            : 'border-gray-600 bg-gray-800/40 hover:border-gray-500'
                        }`}
                      >
                        <input
                          type="radio"
                          value="overwrite"
                          checked={importMode === 'overwrite'}
                          onChange={(e) => setImportMode(e.target.value as ImportMode)}
                          className="mt-1 mr-1"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-200">Reemplazar todas</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Elimina las contraseñas actuales y deja solo las del archivo. Esta acción no se puede deshacer.
                          </p>
                        </div>
                      </label>
                    </div>

                    <div className="rounded-md border border-gray-700 bg-gray-800/40 p-3">
                      <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                        Vista previa
                      </p>
                      <div className="max-h-[240px] overflow-y-auto space-y-2 pr-1">
                        {previewImportedPasswords?.map((entry) => (
                          <div
                            key={entry.id}
                            className="p-3 rounded-md bg-gray-800 border border-gray-700"
                          >
                            <p className="font-semibold text-cyan-400 truncate">{entry.site}</p>
                            <p className="text-sm text-gray-300 truncate">{entry.username}</p>
                            <p className="text-xs text-gray-500 mt-1 truncate">{entry.category}</p>
                          </div>
                        ))}
                        {(!previewImportedPasswords || previewImportedPasswords.length === 0) && (
                          <p className="text-sm text-gray-500 italic text-center py-4">
                            No hay contraseñas para mostrar.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {error && <p className="text-red-400 text-sm pl-1">{error}</p>}
            {success && importStep !== 1 && (
              <p className="text-green-400 text-sm pl-1">{success}</p>
            )}

            <div className="flex justify-between gap-3 pt-2">
              <button
                onClick={handleImportBack}
                className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors min-w-[120px]"
              >
                Atrás
              </button>
              {(() => {
                const nextDisabled =
                  (importStep === 1 && !selectedFile) ||
                  (importStep === 2 && (!importPattern || importPattern.length < 4)) ||
                  (importStep === 3 && (!previewImportedPasswords || previewImportedPasswords.length === 0));
                return (
                  <button
                    onClick={() => void handleImportNext()}
                    disabled={nextDisabled}
                    className="px-5 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed min-w-[200px]"
                  >
                    {importStep === 3 ? 'Restaurar respaldo' : 'Siguiente'}
                  </button>
                );
              })()}
            </div>
          </div>
        )}

        {mode === 'shareQR' && (
          <div className="space-y-3.5 sm:space-y-5">
            <div className="space-y-1">
              <p className="text-gray-400 text-sm">
                Transfiere contraseñas cifradas a otro dispositivo siguiendo este flujo guiado.
              </p>
            </div>

            <div className="pt-0.5 pb-1.5 sm:pt-1 sm:pb-2">
              <div className="max-w-[420px] mx-auto">
                <div className="flex items-start justify-between px-0.5 sm:px-1">
                  <div className="flex flex-col items-center gap-1 sm:gap-2 flex-1">
                    <div
                      className={`relative z-10 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-colors ${
                        shareQRStep > 1
                          ? 'bg-cyan-600 border-cyan-500 text-white shadow-[0_0_0_2px_rgba(168,85,247,0.15)]'
                          : shareQRStep === 1
                          ? 'bg-cyan-600 border-cyan-400 text-white ring-4 ring-cyan-500/20'
                          : 'bg-gray-800 border-gray-600 text-gray-500'
                      }`}
                    >
                      {shareQRStep > 1 ? '✓' : '1'}
                    </div>
                    <div className="text-center">
                      <p
                        className={`text-[10px] sm:text-[11px] font-semibold leading-tight ${
                          shareQRStep >= 1 ? 'text-gray-200' : 'text-gray-500'
                        }`}
                      >
                        Seleccionar
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 flex items-center pt-3 sm:pt-4 mx-0.5 sm:mx-1">
                    <div
                      className={`h-0.5 w-full rounded-full transition-colors ${
                        shareQRStep > 1 ? 'bg-cyan-500' : 'bg-gray-700'
                      }`}
                    />
                  </div>

                  <div className="flex flex-col items-center gap-1 sm:gap-2 flex-1">
                    <div
                      className={`relative z-10 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-colors ${
                        shareQRStep > 2
                          ? 'bg-cyan-600 border-cyan-500 text-white shadow-[0_0_0_2px_rgba(168,85,247,0.15)]'
                          : shareQRStep === 2
                          ? 'bg-cyan-600 border-cyan-400 text-white ring-4 ring-cyan-500/20'
                          : 'bg-gray-800 border-gray-600 text-gray-500'
                      }`}
                    >
                      {shareQRStep > 2 ? '✓' : '2'}
                    </div>
                    <div className="text-center">
                      <p
                        className={`text-[10px] sm:text-[11px] font-semibold leading-tight ${
                          shareQRStep >= 2 ? 'text-gray-200' : 'text-gray-500'
                        }`}
                      >
                        Patrón
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 flex items-center pt-3 sm:pt-4 mx-0.5 sm:mx-1">
                    <div
                      className={`h-0.5 w-full rounded-full transition-colors ${
                        shareQRStep > 2 ? 'bg-cyan-500' : 'bg-gray-700'
                      }`}
                    />
                  </div>

                  <div className="flex flex-col items-center gap-1 sm:gap-2 flex-1">
                    <div
                      className={`relative z-10 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-colors ${
                        shareQRStep >= 3
                          ? 'bg-cyan-600 border-cyan-400 text-white ring-4 ring-cyan-500/20'
                          : 'bg-gray-800 border-gray-600 text-gray-500'
                      }`}
                    >
                      3
                    </div>
                    <div className="text-center">
                      <p
                        className={`text-[10px] sm:text-[11px] font-semibold leading-tight ${
                          shareQRStep >= 3 ? 'text-gray-200' : 'text-gray-500'
                        }`}
                      >
                        QR
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              key={shareQRAnimKey}
              className="animate-in fade-in zoom-in-[99%] duration-200 ease-out"
            >
              {shareQRStep === 1 && (
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">
                        Paso 1 — Selecciona las contraseñas
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Elige qué entradas quieres transferir al otro dispositivo.
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs font-semibold text-gray-500 px-2 py-0.5 rounded-md bg-gray-800/70 border border-gray-700/60">
                        {selectedPasswordIds.length} / {passwords.length}
                      </span>
                      {(() => {
                        if (selectedPasswordIds.length === 0) return null;
                        const selected = passwords.filter((p) => selectedPasswordIds.includes(p.id));
                        const rough = roughEstimateQRChunks(sanitizePasswordsForQR(selected));
                        const exact = qrSharePattern
                          ? estimateQRChunksNeeded(
                              { passwords: sanitizePasswordsForQR(selected) },
                              patternToString(qrSharePattern)
                            )
                          : null;
                        const count = exact ?? rough;
                        return (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                            ~{count} QR{count > 1 ? 's' : ''} necesario{count > 1 ? 's' : ''}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {passwords.length === 0 ? (
                    <div className="p-4 rounded-md border border-gray-700 bg-gray-800/60 text-gray-400 text-center">
                      No hay contraseñas disponibles para enviar.
                    </div>
                  ) : (
                    <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
                      {passwords.map((entry) => {
                        const isSelected = selectedPasswordIds.includes(entry.id);
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => togglePasswordSelection(entry.id)}
                            className={`w-full text-left p-3 rounded-md border transition-colors ${
                              isSelected
                                ? 'border-cyan-500/60 bg-cyan-500/10'
                                : 'border-gray-700 bg-gray-800/50 hover:bg-gray-700/40'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-cyan-400 truncate">{entry.site}</p>
                                <p className="text-sm text-gray-300 truncate">{entry.username}</p>
                                <p className="text-xs text-gray-500 mt-1 truncate">{entry.category}</p>
                              </div>
                              <div className={`mt-0.5 h-5 w-5 flex-shrink-0 rounded border flex items-center justify-center ${
                                isSelected ? 'border-cyan-400 bg-cyan-500/25' : 'border-gray-500'
                              }`}>
                                {isSelected && <span className="text-cyan-200 text-xs font-bold">✓</span>}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {passwords.length > 0 && (
                    <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-700/60">
                      <button
                        onClick={() => setSelectedPasswordIds(passwords.map(p => p.id))}
                        className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        Seleccionar todas
                      </button>
                      <button
                        onClick={() => setSelectedPasswordIds([])}
                        disabled={selectedPasswordIds.length === 0}
                        className="text-xs text-gray-400 hover:text-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Limpiar selección
                      </button>
                    </div>
                  )}
                </div>
              )}

              {shareQRStep === 2 && (
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-200">
                      Paso 2 — Patrón de desbloqueo de este dispositivo
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Dibuja el patrón que usas para abrir SecurePass aquí. Servirá para cifrar el contenido del QR.
                    </p>
                  </div>
                  <div className="flex justify-center pt-2">
                    <GesturePad
                      onPatternComplete={(p) => {
                        setQrSharePattern(p);
                        setError('');
                      }}
                      minPoints={4}
                      resetKey={qrSharePatternReset}
                    />
                  </div>
                  <div className="flex flex-col items-center gap-1 min-h-[44px]">
                    {qrSharePattern && (
                      <p className="text-xs text-green-400">✓ Patrón listo para cifrar.</p>
                    )}
                    {qrSharePattern && (
                      <button
                        onClick={() => {
                          setQrSharePattern(null);
                          setQrSharePatternReset((k) => k + 1);
                          setGeneratedQRData('');
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-gray-700/60 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-600/40"
                      >
                        ↺ Reiniciar patrón
                      </button>
                    )}
                  </div>
                </div>
              )}

              {shareQRStep === 3 && (
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4 space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">
                        Paso 3 — Transferencia en curso
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {generatedQRChunks.length > 1
                          ? 'Muestra todos los códigos QR al otro dispositivo. Puedes navegar con las flechas.'
                          : 'Muéstraselo al otro dispositivo o guárdalo como imagen.'}
                      </p>
                    </div>
                    {generatedQRChunks.length > 1 && (
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                          QR {currentQRChunkIndex + 1} / {generatedQRChunks.length}
                        </span>
                      </div>
                    )}
                  </div>

                  {generatedQRChunks.length > 1 && (
                    <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-[width] duration-200"
                        style={{
                          width: `${((currentQRChunkIndex + 1) / generatedQRChunks.length) * 100}%`
                        }}
                      />
                    </div>
                  )}

                  <div className="flex flex-col items-center justify-center text-center py-1">
                    {generatedQRData ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="bg-white p-3 rounded-lg shadow-lg">
                          <div ref={qrCodeContainerRef}>
                            <QRCode value={generatedQRData} size={300} level="Q" />
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                          <button
                            onClick={() => void handleSaveQRImage()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors text-sm border border-gray-600"
                          >
                            💾 Guardar como imagen PNG
                          </button>
                          <p className="text-xs text-gray-500 max-w-[320px]">
                            El otro dispositivo necesitará el patrón de desbloqueo de este dispositivo para descifrarlo.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-gray-500 px-2">
                        <div className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-600 flex items-center justify-center text-3xl opacity-50">
                          ⬚
                        </div>
                        <p className="text-sm">
                          Generando QR cifrado…
                        </p>
                      </div>
                    )}
                  </div>

                  {generatedQRChunks.length > 1 && (
                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-700/60">
                      <button
                        onClick={() => {
                          setCurrentQRChunkIndex((prev) => {
                            const next = Math.max(0, prev - 1);
                            setGeneratedQRData(generatedQRChunks[next] || '');
                            return next;
                          });
                        }}
                        disabled={currentQRChunkIndex === 0}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-gray-700/70 hover:bg-gray-700 text-sm text-gray-200 border border-gray-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        ← Anterior
                      </button>
                      <p className="text-xs text-gray-500 font-medium">
                        Puede escanearse en cualquier orden
                      </p>
                      <button
                        onClick={() => {
                          setCurrentQRChunkIndex((prev) => {
                            const next = Math.min(generatedQRChunks.length - 1, prev + 1);
                            setGeneratedQRData(generatedQRChunks[next] || '');
                            return next;
                          });
                        }}
                        disabled={currentQRChunkIndex >= generatedQRChunks.length - 1}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 text-sm text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Siguiente →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && <p className="text-red-400 text-sm pl-1">{error}</p>}
            {success && <p className="text-green-400 text-sm pl-1">{success}</p>}

            <div className="flex justify-between gap-3 pt-2">
              <button
                onClick={async () => {
                  setError('');
                  if (shareQRStep === 1) {
                    await changeMode('select');
                    return;
                  }
                  const next = (shareQRStep - 1) as 1 | 2 | 3;
                  setShareQRStep(next);
                  setShareQRAnimKey((k) => k + 1);
                  if (next === 2) {
                    setGeneratedQRData('');
                    setGeneratedQRChunks([]);
                    setCurrentQRChunkIndex(0);
                  }
                }}
                className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors min-w-[120px]"
              >
                Atrás
              </button>

              {shareQRStep < 3 ? (
                <button
                  onClick={async () => {
                    setError('');
                    if (shareQRStep === 1) {
                      if (selectedPasswordIds.length === 0) {
                        setError('Selecciona al menos una contraseña para continuar.');
                        return;
                      }
                      setShareQRStep(2);
                      setShareQRAnimKey((k) => k + 1);
                      return;
                    }
                    if (shareQRStep === 2) {
                      if (!qrSharePattern) {
                        setError('Dibuja tu patrón de desbloqueo para continuar.');
                        return;
                      }
                      const ok = handleGenerateQR();
                      if (ok) {
                        setShareQRStep(3);
                        setShareQRAnimKey((k) => k + 1);
                      }
                    }
                  }}
                  disabled={
                    (shareQRStep === 1 && selectedPasswordIds.length === 0) ||
                    (shareQRStep === 2 && !qrSharePattern)
                  }
                  className="px-5 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed min-w-[160px]"
                >
                  Continuar
                </button>
              ) : (
                <button
                  onClick={() => void handleClose()}
                  className="px-5 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold min-w-[160px]"
                >
                  Finalizar
                </button>
              )}
            </div>
          </div>
        )}

        {mode === 'scanQR' && (
          <div className="space-y-3 sm:space-y-4">
            <p className="text-gray-400 text-sm">
              Recibe contraseñas desde otro dispositivo usando la cámara o una imagen QR. Si la transferencia usa varios códigos, escanéalos todos.
            </p>

            <div className="max-w-[420px] mx-auto">
              <div className="flex items-start justify-between px-0.5 sm:px-1">
                <div className="flex flex-col items-center gap-1 sm:gap-2 flex-1">
                  <div
                    className={`relative z-10 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-colors ${
                      scanQRStep > 1
                        ? 'bg-cyan-600 border-cyan-500 text-white shadow-[0_0_0_2px_rgba(168,85,247,0.15)]'
                        : scanQRStep === 1
                        ? 'bg-cyan-600 border-cyan-400 text-white ring-4 ring-cyan-500/20'
                        : 'bg-gray-800 border-gray-600 text-gray-500'
                    }`}
                  >
                    {scanQRStep > 1 ? '✓' : '1'}
                  </div>
                  <div className="text-center">
                    <p
                      className={`text-[10px] sm:text-[11px] font-semibold leading-tight ${
                        scanQRStep >= 1 ? 'text-gray-200' : 'text-gray-500'
                      }`}
                    >
                      Escanear
                    </p>
                  </div>
                </div>

                <div className="flex-1 flex items-center pt-3 sm:pt-4 mx-0.5 sm:mx-1">
                  <div
                    className={`h-0.5 w-full rounded-full transition-colors ${
                      scanQRStep > 1 ? 'bg-cyan-500' : 'bg-gray-700'
                    }`}
                  />
                </div>

                <div className="flex flex-col items-center gap-1 sm:gap-2 flex-1">
                  <div
                    className={`relative z-10 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-colors ${
                      scanQRStep > 2
                        ? 'bg-cyan-600 border-cyan-500 text-white shadow-[0_0_0_2px_rgba(168,85,247,0.15)]'
                        : scanQRStep === 2
                        ? 'bg-cyan-600 border-cyan-400 text-white ring-4 ring-cyan-500/20'
                        : 'bg-gray-800 border-gray-600 text-gray-500'
                    }`}
                  >
                    {scanQRStep > 2 ? '✓' : '2'}
                  </div>
                  <div className="text-center">
                    <p
                      className={`text-[10px] sm:text-[11px] font-semibold leading-tight ${
                        scanQRStep >= 2 ? 'text-gray-200' : 'text-gray-500'
                      }`}
                    >
                      Patrón
                    </p>
                  </div>
                </div>

                <div className="flex-1 flex items-center pt-3 sm:pt-4 mx-0.5 sm:mx-1">
                  <div
                    className={`h-0.5 w-full rounded-full transition-colors ${
                      scanQRStep > 2 ? 'bg-cyan-500' : 'bg-gray-700'
                    }`}
                  />
                </div>

                <div className="flex flex-col items-center gap-1 sm:gap-2 flex-1">
                  <div
                    className={`relative z-10 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-colors ${
                      scanQRStep >= 3
                        ? 'bg-cyan-600 border-cyan-400 text-white ring-4 ring-cyan-500/20'
                        : 'bg-gray-800 border-gray-600 text-gray-500'
                    }`}
                  >
                    3
                  </div>
                  <div className="text-center">
                    <p
                      className={`text-[10px] sm:text-[11px] font-semibold leading-tight ${
                        scanQRStep >= 3 ? 'text-gray-200' : 'text-gray-500'
                      }`}
                    >
                      Confirmar
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div
              key={scanQRAnimKey}
              className="animate-in fade-in zoom-in-[99%] duration-200 ease-out"
            >
              {(() => {
                const readySingle = !!pendingQRPayload;
                const multi = !!activeTransferId && !!receivedChunks[activeTransferId];
                const readyMulti =
                  multi &&
                  Object.keys(receivedChunks[activeTransferId].chunks).length ===
                    receivedChunks[activeTransferId].totalChunks;
                const transferReady = readySingle || readyMulti;

                if (scanQRStep === 1) {
                  const partialMulti =
                    multi &&
                    Object.keys(receivedChunks[activeTransferId].chunks).length <
                      receivedChunks[activeTransferId].totalChunks;
                  const loadedAny = readySingle || multi;
                  const imageBtnLabel = partialMulti
                    ? 'Cargar siguiente imagen QR'
                    : readySingle
                    ? 'Cargar otra imagen QR'
                    : 'Cargar imagen QR';

                  return (
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4 space-y-3 sm:space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="text-sm font-semibold text-gray-200">
                            Paso 1 — Obtén los QR
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Usa la cámara del dispositivo o carga una imagen PNG/JPG.
                          </p>
                        </div>
                        {multi && (
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                            {Object.keys(receivedChunks[activeTransferId].chunks).length} /{' '}
                            {receivedChunks[activeTransferId].totalChunks}
                          </span>
                        )}
                      </div>

                      {multi && (
                        <div className="space-y-2">
                          <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-[width] duration-200"
                              style={{
                                width: `${(Object.keys(
                                  receivedChunks[activeTransferId].chunks
                                ).length /
                                  receivedChunks[activeTransferId].totalChunks) *
                                  100}%`
                              }}
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {Array.from(
                              { length: receivedChunks[activeTransferId].totalChunks },
                              (_, i) => i + 1
                            ).map((chunkIndex) => {
                              const done = !!receivedChunks[activeTransferId].chunks[chunkIndex];
                              return (
                                <div
                                  key={chunkIndex}
                                  className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold border transition-colors ${
                                    done
                                      ? 'bg-cyan-500/30 border-cyan-500/60 text-cyan-200'
                                      : 'bg-gray-800 border-gray-600 text-gray-500'
                                  }`}
                                >
                                  {done ? '✓' : chunkIndex}
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-[11px] text-gray-500 pl-0.5">
                            Transferencia #{activeTransferId}
                          </p>
                        </div>
                      )}

                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          onClick={() => void handleStartCameraScan()}
                          className="w-full px-4 py-2.5 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold text-sm"
                        >
                          Usar cámara
                        </button>
                        <button
                          onClick={handleImageFileSelect}
                          className="w-full px-4 py-2.5 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors font-semibold text-sm"
                        >
                          {imageBtnLabel}
                        </button>
                      </div>

                      <input
                        ref={imageFileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                        onChange={(e) => void handleImageSelection(e.target.files?.[0] || null)}
                        className="hidden"
                      />

                      {scanSource === 'camera' && !pendingQRPayload && (
                        <div className="rounded-lg border border-gray-700 overflow-hidden space-y-2">
                          {(hasTorch || availableCameras.length > 1) && (
                            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-900/80 border-b border-gray-700">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                                  Cámara activa
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {hasTorch && (
                                  <button
                                    onClick={() => void toggleTorch()}
                                    className={`p-1.5 rounded-md border text-[11px] font-medium flex items-center gap-1 transition-all ${
                                      torchOn
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
                                        : 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700'
                                    }`}
                                    title={torchOn ? 'Apagar linterna' : 'Encender linterna'}
                                  >
                                    {torchOn ? (
                                      <ZapIcon className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                                    ) : (
                                      <ZapOffIcon className="w-3.5 h-3.5" />
                                    )}
                                    <span className="hidden sm:inline">
                                      {torchOn ? 'Linterna On' : 'Linterna'}
                                    </span>
                                  </button>
                                )}
                                {availableCameras.length > 1 && (
                                  <button
                                    onClick={() => void handleToggleFrontBack()}
                                    className="p-1.5 rounded-md border bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700 transition-all flex items-center gap-1 text-[11px] font-medium"
                                    title="Cambiar lente (frontal/trasera)"
                                  >
                                    <SwitchCameraIcon className="w-3.5 h-3.5 text-cyan-400" />
                                    <span className="hidden sm:inline">Cambiar</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          <div className="relative w-full bg-black">
                            <div
                              id={QR_READER_ELEMENT_ID}
                              className="w-full min-h-[220px] sm:min-h-[260px] overflow-hidden bg-black"
                            />
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                              <div
                                className="relative flex items-center justify-center animate-qr-reticle-pulse"
                                style={{ width: '220px', height: '220px' }}
                              >
                                <div className="absolute inset-0 rounded-xl border border-cyan-400/40 shadow-[0_0_40px_rgba(34,211,238,0.15)]" />
                                <div className="absolute top-0 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-cyan-400 rounded-tl-lg" />
                                <div className="absolute top-0 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-cyan-400 rounded-tr-lg" />
                                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-cyan-400 rounded-bl-lg" />
                                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-cyan-400 rounded-br-lg" />
                                <div className="w-[calc(100%-8px)] h-0.5 left-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_rgba(34,211,238,0.7)] absolute animate-qr-scan-line" />
                              </div>
                            </div>
                          </div>

                          {availableCameras.length > 1 && (
                            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-900/60 border-t border-gray-700 text-[11px]">
                              <span className="text-gray-400 font-medium flex items-center gap-1.5">
                                <CameraIcon className="w-3.5 h-3.5 text-cyan-400" />
                                Seleccionar lente:
                              </span>
                              <select
                                value={selectedCameraId}
                                onChange={(e) => void handleChangeCamera(e.target.value)}
                                className="bg-gray-800 text-gray-200 border border-gray-600 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40"
                              >
                                <option value="">Automática (por defecto)</option>
                                {availableCameras.map((cam) => (
                                  <option key={cam.id} value={cam.id}>
                                    {cam.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )}

                      {transferReady ? (
                        multi && receivedChunks[activeTransferId].totalChunks > 1 ? (
                          <div className="flex items-start gap-3 text-sm rounded-md border border-green-500/20 bg-green-500/5 px-4 py-3">
                            <div className="text-green-400 text-xl leading-none mt-0.5">✓</div>
                            <div className="min-w-0 flex-1">
                              <p className="text-gray-100 font-medium">Transferencia completa</p>
                              <p className="text-gray-500 truncate mt-0.5">
                                {Object.keys(receivedChunks[activeTransferId].chunks).length} QR de{' '}
                                {receivedChunks[activeTransferId].totalChunks} listos para descifrar.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3 text-sm rounded-md border border-green-500/20 bg-green-500/5 px-4 py-3">
                            <div className="text-green-400 text-xl leading-none mt-0.5">✓</div>
                            <div className="min-w-0 flex-1">
                              <p className="text-gray-100 font-medium">QR leído correctamente</p>
                              {selectedImageName && (
                                <p className="text-gray-500 truncate mt-0.5">{selectedImageName}</p>
                              )}
                            </div>
                          </div>
                        )
                      ) : scanSource === 'image' ? (
                        <p className="text-sm text-gray-500 text-center italic px-3 pt-1">
                          {partialMulti
                            ? `Carga el siguiente QR que falte (${
                                receivedChunks[activeTransferId!].totalChunks -
                                Object.keys(receivedChunks[activeTransferId!].chunks).length
                              } restantes).`
                            : loadedAny
                            ? 'Carga otra imagen QR para reemplazar la lectura anterior.'
                            : 'Selecciona una imagen PNG/JPG para empezar la lectura del QR.'}
                        </p>
                      ) : !scanSource ? (
                        <p className="text-sm text-gray-500 text-center italic px-3 pt-1">
                          Pulsa una de las dos opciones anteriores para obtener el QR.
                        </p>
                      ) : null}

                      {scanSource && (
                        <div className="flex justify-center pt-1">
                          <button
                            onClick={() => void handleRestartQRScan()}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-gray-700/60 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-600/40"
                          >
                            ↺ Reiniciar lectura QR
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }

                if (scanQRStep === 2) {
                  return (
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4 space-y-3 sm:space-y-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-200">
                          Paso 2 — Patrón de desbloqueo
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {multi
                            ? `Dibuja el patrón del dispositivo que envió los ${receivedChunks[activeTransferId!].totalChunks} QR.`
                            : 'Dibuja el patrón de desbloqueo del dispositivo que envió el QR.'}
                        </p>
                      </div>

                      <div className="rounded-md border border-gray-700 bg-gray-800/40 p-4 space-y-2">
                        <div className="flex justify-center">
                          <GesturePad
                            onPatternComplete={(p) => setQrImportPattern(p)}
                            minPoints={4}
                            resetKey={qrImportPatternReset}
                          />
                        </div>
                        <div className="flex flex-col items-center gap-1 min-h-[40px]">
                          {qrImportPattern && qrImportPattern.length >= 4 ? (
                            <p className="text-xs text-green-400">
                              ✓ Patrón listo. Pulsa "Siguiente" para descifrar.
                            </p>
                          ) : qrImportPattern ? (
                            <p className="text-xs text-amber-400/90">
                              El patrón debe tener al menos 4 puntos.
                            </p>
                          ) : null}
                        </div>
                        {qrImportPattern && (
                          <div className="flex justify-center pt-1">
                            <button
                              onClick={() => {
                                setQrImportPattern(null);
                                setQrImportPatternReset((k) => k + 1);
                                setSuccess('');
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-gray-700/60 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-600/40"
                            >
                              ↺ Reiniciar patrón
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4 space-y-3">
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <div>
                          <p className="text-sm font-semibold text-gray-200">
                            Paso 3 — Confirma la importación
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Elige cómo integrar estas contraseñas en tu bóveda local.
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-gray-500">
                          {scannedPasswords.length} contraseñas
                        </span>
                      </div>

                      <div className="space-y-2">
                        <label
                          className={`flex items-start gap-3 p-3 rounded-md border transition-colors cursor-pointer ${
                            importMode === 'merge'
                              ? 'border-cyan-500/60 bg-cyan-500/5'
                              : 'border-gray-600 bg-gray-800/40 hover:border-gray-500'
                          }`}
                        >
                          <input
                            type="radio"
                            value="merge"
                            checked={importMode === 'merge'}
                            onChange={(e) => setImportMode(e.target.value as ImportMode)}
                            className="mt-1 mr-1"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-200">
                              Agregar a las existentes
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Fusiona las nuevas contraseñas con las actuales.
                            </p>
                          </div>
                        </label>
                        <label
                          className={`flex items-start gap-3 p-3 rounded-md border transition-colors cursor-pointer ${
                            importMode === 'overwrite'
                              ? 'border-cyan-500/60 bg-cyan-500/5'
                              : 'border-gray-600 bg-gray-800/40 hover:border-gray-500'
                          }`}
                        >
                          <input
                            type="radio"
                            value="overwrite"
                            checked={importMode === 'overwrite'}
                            onChange={(e) => setImportMode(e.target.value as ImportMode)}
                            className="mt-1 mr-1"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-200">Reemplazar todas</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Elimina las contraseñas actuales y deja solo las recibidas.
                            </p>
                          </div>
                        </label>
                      </div>

                      <div className="rounded-md border border-gray-700 bg-gray-800/40 p-3">
                        <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                          Vista previa
                        </p>
                        <div className="max-h-[240px] overflow-y-auto space-y-2 pr-1">
                          {scannedPasswords.map((entry) => (
                            <div
                              key={entry.id}
                              className="p-3 rounded-md bg-gray-800 border border-gray-700"
                            >
                              <p className="font-semibold text-cyan-400 truncate">{entry.site}</p>
                              <p className="text-sm text-gray-300 truncate">{entry.username}</p>
                              <p className="text-xs text-gray-500 mt-1 truncate">{entry.category}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {error && <p className="text-red-400 text-sm pl-1">{error}</p>}
            {success &&
              scanQRStep === 1 &&
              !pendingQRPayload &&
              !activeTransferId && <p className="text-green-400 text-sm pl-1">{success}</p>}

            <div className="flex justify-between gap-3 pt-2">
              <button
                onClick={handleScanQRBack}
                className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors min-w-[120px]"
              >
                Atrás
              </button>
              {(() => {
                const readySingle = !!pendingQRPayload;
                const multi = !!activeTransferId && !!receivedChunks[activeTransferId];
                const readyMulti =
                  multi &&
                  Object.keys(receivedChunks[activeTransferId].chunks).length ===
                    receivedChunks[activeTransferId].totalChunks;
                const transferReady = readySingle || readyMulti;
                const nextDisabled =
                  (scanQRStep === 1 && !transferReady) ||
                  (scanQRStep === 2 && (!qrImportPattern || qrImportPattern.length < 4)) ||
                  (scanQRStep === 3 && scannedPasswords.length === 0);
                return (
                  <button
                    onClick={() => void handleScanQRNext()}
                    disabled={nextDisabled}
                    className="px-5 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed min-w-[200px]"
                  >
                    {scanQRStep === 3 ? 'Recibir contraseñas' : 'Siguiente'}
                  </button>
                );
              })()}
            </div>
          </div>
        )}
    </>
  );

  if (resolvedVariant === 'fullscreen') {
    return (
      <div className={overlayOuter}>
        <header className="sticky top-0 z-20 flex-shrink-0 bg-gray-800/90 backdrop-blur-sm border-b border-gray-700/60 px-2.5 sm:px-5 pt-safe-top pb-2 sm:py-3">
          <div className="mx-auto w-full max-w-4xl">
            <TitleHeader />
          </div>
        </header>
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-y-auto px-2.5 sm:px-5 py-2.5 sm:py-4 pb-safe-bottom"
        >
          <div className="mx-auto w-full max-w-4xl">
            <div className={innerBody}>{contentModes}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={overlayOuter}>
      <div ref={scrollContainerRef} className={innerBody}>
        <div className="mb-6">
          <TitleHeader showCloseButton={false} />
        </div>
        {contentModes}
      </div>
    </div>
  );
};

export default ImportExportModal;
