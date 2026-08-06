import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { Html5Qrcode } from 'html5-qrcode';
import { PasswordEntry } from '../types';
import { EncryptedData, EncryptionService } from '../utils/encryption';
import { ImportExportIcon } from './Icons';
import GesturePad from './GesturePad';

const patternToString = (pattern: number[]): string => pattern.join(',');

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (passwords: PasswordEntry[]) => void;
  onExportSuccess?: () => void;
  passwords: PasswordEntry[];
}

type Mode = 'select' | 'export' | 'import' | 'shareQR' | 'scanQR';
type ImportMode = 'merge' | 'overwrite';
type ScanSource = 'camera' | 'image' | null;

interface QRSharePayload {
  app: 'SecurePass';
  version: '2.0';
  type: 'password-share';
  timestamp: number;
  encrypted: EncryptedData;
}

interface QRTransferPassword {
  site: string;
  username: string;
  password: string;
  category: string;
}

const QR_READER_ELEMENT_ID = 'securepass-qr-reader';
const MAX_QR_PAYLOAD_BYTES = 1200;
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

const isValidQRPayload = (payload: any): payload is QRSharePayload => {
  return (
    payload &&
    payload.app === 'SecurePass' &&
    payload.type === 'password-share' &&
    typeof payload.version === 'string' &&
    typeof payload.timestamp === 'number' &&
    payload.encrypted &&
    typeof payload.encrypted.data === 'string' &&
    typeof payload.encrypted.iv === 'string' &&
    typeof payload.encrypted.salt === 'string'
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
  passwords
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
  const [selectedPasswordIds, setSelectedPasswordIds] = useState<string[]>([]);
  const [qrSharePattern, setQrSharePattern] = useState<number[] | null>(null);
  const [qrSharePatternReset, setQrSharePatternReset] = useState(0);
  const [generatedQRData, setGeneratedQRData] = useState('');
  const [pendingQRPayload, setPendingQRPayload] = useState<QRSharePayload | null>(null);
  const [qrImportPattern, setQrImportPattern] = useState<number[] | null>(null);
  const [qrImportPatternReset, setQrImportPatternReset] = useState(0);
  const [scannedPasswords, setScannedPasswords] = useState<PasswordEntry[]>([]);
  const [scanSource, setScanSource] = useState<ScanSource>(null);
  const [selectedImageName, setSelectedImageName] = useState('');
  const [scannerRestartKey, setScannerRestartKey] = useState(0);
  const [importPattern, setImportPattern] = useState<number[] | null>(null);
  const [importPatternReset, setImportPatternReset] = useState(0);
  const [patternError, setPatternError] = useState<string>('');
  const vaultFileInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const qrCodeContainerRef = useRef<HTMLDivElement>(null);
  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const isScannerRunningRef = useRef(false);
  const isScanLockedRef = useRef(false);

  useEffect(() => {
    if (patternError) {
      const t = setTimeout(() => setPatternError(''), 1200);
      return () => clearTimeout(t);
    }
  }, [patternError]);

  const [lastImportMode, setLastImportMode] = useState<ImportMode>(() => {
    const saved = localStorage.getItem('vault_last_import_mode');
    return (saved as ImportMode) || 'merge';
  });

  const stopQRScanner = useCallback(async () => {
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

  const resetQRImportState = useCallback(() => {
    isScanLockedRef.current = false;
    setPendingQRPayload(null);
    setQrImportPattern(null);
    setQrImportPatternReset((k) => k + 1);
    setScannedPasswords([]);
    setScanSource(null);
    setSelectedImageName('');
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
    setGeneratedQRData('');
    setImportPattern(null);
    setImportPatternReset((k) => k + 1);
    setPatternError('');
    resetQRImportState();
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
      setSelectedFileName('');
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
      setGeneratedQRData('');
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
      const blob = new Blob([JSON.stringify(encrypted)], { type: 'application/json' });
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

  const handleImport = async () => {
    if (!importPattern) {
      setError('Dibuja el patrón de desbloqueo del respaldo');
      return;
    }

    const file = vaultFileInputRef.current?.files?.[0];
    if (!file) {
      setError('Por favor selecciona un archivo');
      return;
    }

    try {
      const text = await file.text();
      const encrypted = JSON.parse(text);
      const decryptedJson = EncryptionService.decrypt(encrypted, patternToString(importPattern));
      const importData = JSON.parse(decryptedJson);

      if (!importData.passwords || !Array.isArray(importData.passwords)) {
        throw new Error('Formato de archivo inválido');
      }

      localStorage.setItem('vault_last_import_mode', importMode);
      setLastImportMode(importMode);

      const importedPasswords = normalizePasswords(importData.passwords);

      onImport(importedPasswords);
      setSuccess('Archivo importado exitosamente');
      setTimeout(() => {
        void handleClose();
      }, 2000);
    } catch (error) {
      setError('Error al importar: ' + (error as Error).message);
    }
  };

  const handleGenerateQR = () => {
    const selectedPasswords = passwords.filter((password) =>
      selectedPasswordIds.includes(password.id)
    );

    if (selectedPasswords.length === 0) {
      setError('Selecciona al menos una contraseña para enviar');
      return;
    }

    if (!qrSharePattern) {
      setError('Dibuja el patrón de desbloqueo de este dispositivo para generar el QR');
      return;
    }

    try {
      const encrypted = EncryptionService.encrypt(
        JSON.stringify({ passwords: sanitizePasswordsForQR(selectedPasswords) }),
        patternToString(qrSharePattern)
      );

      const payload: QRSharePayload = {
        app: 'SecurePass',
        version: '2.0',
        type: 'password-share',
        timestamp: Date.now(),
        encrypted
      };

      const qrData = JSON.stringify(payload);
      const payloadSize = new TextEncoder().encode(qrData).length;

      if (payloadSize > MAX_QR_PAYLOAD_BYTES) {
        throw new Error('La selección es demasiado grande para un único QR. Reduce la cantidad de contraseñas.');
      }

      setGeneratedQRData(qrData);
      setSuccess('QR generado. Escanéalo o impórtalo desde imagen en el otro dispositivo.');
      setError('');
    } catch (error) {
      setGeneratedQRData('');
      setError('Error al generar el QR: ' + (error as Error).message);
    }
  };

  const handleSaveQRImage = async () => {
    const qrSvg = qrCodeContainerRef.current?.querySelector('svg');
    if (!qrSvg || !generatedQRData) {
      setError('Genera el QR antes de guardarlo como imagen.');
      return;
    }

    try {
      const svgMarkup = new XMLSerializer().serializeToString(qrSvg);
      const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1080;
        const context = canvas.getContext('2d');

        if (!context) {
          URL.revokeObjectURL(svgUrl);
          setError('No se pudo preparar la imagen del QR para guardarla.');
          return;
        }

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

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
      };

      image.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        setError('No se pudo guardar el QR como imagen.');
      };

      image.src = svgUrl;
    } catch (error) {
      setError('Error al guardar el QR: ' + (error as Error).message);
    }
  };

  const handleParsedQRPayload = useCallback(async (decodedText: string, source: Exclude<ScanSource, null>) => {
    try {
      const parsedPayload = JSON.parse(decodedText);

      if (!isValidQRPayload(parsedPayload)) {
        throw new Error('El QR no pertenece a una transferencia válida de SecurePass');
      }

      if (source === 'camera') {
        await stopQRScanner();
      }

      isScanLockedRef.current = true;
      setPendingQRPayload(parsedPayload);
      setQrImportPattern(null);
      setQrImportPatternReset((k) => k + 1);
      setScannedPasswords([]);
      setScanSource(source);
      setError('');
    } catch (error) {
      setError('Error al leer el QR: ' + (error as Error).message);
    }
  }, [stopQRScanner]);

  const handleDecryptScannedQR = async () => {
    if (!pendingQRPayload) {
      setError('Primero debes escanear un QR o cargar una imagen con un QR válido');
      return;
    }

    if (!qrImportPattern) {
      setError('Dibuja el patrón de desbloqueo del dispositivo origen');
      return;
    }

    try {
      const decryptedJson = EncryptionService.decrypt(
        pendingQRPayload.encrypted,
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
    } catch {
      setScannedPasswords([]);
      setError('Patrón de desbloqueo incorrecto o contenido QR inválido. No se importó ninguna contraseña.');
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
    setSuccess('Abriendo cámara para escanear el QR...');
    setError('');
    setScanSource('camera');
    setScannerRestartKey((current) => current + 1);
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
      const scanner = new Html5Qrcode(QR_READER_ELEMENT_ID);
      qrScannerRef.current = scanner;
      const decodedText = await scanner.scanFile(file, true);
      scanner.clear();
      qrScannerRef.current = null;
      await handleParsedQRPayload(decodedText, 'image');
    } catch (error) {
      try {
        qrScannerRef.current?.clear();
      } catch {
        // Ignore cleanup errors after a failed scan
      }
      qrScannerRef.current = null;
      setError(QR_IMAGE_ERROR_MESSAGE);
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

      try {
        const scanner = new Html5Qrcode(QR_READER_ELEMENT_ID);
        qrScannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
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

        isScannerRunningRef.current = true;
        setSuccess('Apunta la cámara al QR para continuar con la importación.');
      } catch {
        qrScannerRef.current = null;
        isScannerRunningRef.current = false;
        setSuccess('');
        setError('No se pudo abrir la cámara. Revisa los permisos o usa un navegador compatible.');
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      void stopQRScanner();
    };
  }, [handleParsedQRPayload, isOpen, mode, scanSource, scannerRestartKey, stopQRScanner]);

  if (!isOpen) return null;

  const modalMaxWidth = mode === 'shareQR' || mode === 'scanQR' ? 'max-w-4xl' : 'max-w-md';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-6">
      <div className={`bg-gray-800 rounded-lg shadow-xl p-6 w-full ${modalMaxWidth} text-gray-200 animate-fade-in-up max-h-[90vh] overflow-y-auto`}>
        <h2 className="text-2xl font-bold mb-6 flex items-center">
          <ImportExportIcon className="w-6 h-6 mr-2 text-cyan-400" />
          {mode === 'select' && 'Gestionar bóveda'}
          {mode === 'export' && 'Crear respaldo'}
          {mode === 'import' && 'Restaurar respaldo'}
          {mode === 'shareQR' && 'Enviar por QR'}
          {mode === 'scanQR' && 'Recibir por QR'}
        </h2>

        {mode === 'select' && (
          <div className="space-y-6">
            <p className="text-gray-400">
              Crea o restaura un respaldo, o transfiere contraseñas entre dispositivos.
            </p>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Respaldos
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => void changeMode('export')}
                  className="w-full px-4 py-3 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold"
                >
                  Crear respaldo
                </button>
                <button
                  onClick={() => void changeMode('import')}
                  className="w-full px-4 py-3 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors font-semibold border border-gray-600"
                >
                  Restaurar respaldo
                </button>
              </div>
            </div>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-gray-700" />
              <span className="flex-shrink mx-4 text-xs uppercase tracking-wider text-gray-500 font-semibold">
                Transferencia QR
              </span>
              <div className="flex-grow border-t border-gray-700" />
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Transferencia entre dispositivos
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => void changeMode('shareQR')}
                  className="w-full px-4 py-3 rounded-md bg-purple-600 hover:bg-purple-700 transition-colors font-semibold"
                >
                  Enviar por QR
                </button>
                <button
                  onClick={() => void changeMode('scanQR')}
                  className="w-full px-4 py-3 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors font-semibold border border-gray-600"
                >
                  Recibir por QR
                </button>
              </div>
            </div>

            <button
              onClick={() => void handleClose()}
              className="w-full px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors mt-2"
            >
              Cancelar
            </button>
          </div>
        )}

        {mode === 'export' && (
          <div className="space-y-4">
            <p className="text-gray-400 mb-4">
              Se creará un archivo encriptado con todas tus contraseñas.
            </p>
            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 flex flex-col items-center">
              <p className="text-sm font-medium text-gray-300 mb-1">
                {backupConfirmStep ? 'Confirma el patrón de protección del respaldo' : 'Dibuja un patrón para proteger el respaldo'}
              </p>
              <p className="text-xs text-gray-500 mb-2">
                {backupConfirmStep
                  ? 'Dibuja exactamente el mismo patrón para confirmar.'
                  : 'Conecta al menos 4 puntos. Deberás recordarlo para restaurar este respaldo.'}
              </p>
              <GesturePad
                onPatternComplete={handleExportBackupPattern}
                minPoints={4}
                showError={!!patternError}
                resetKey={backupPatternReset}
              />
              {backupPattern && !backupConfirmStep && (
                <p className="mt-1 text-xs text-green-400">✓ Patrón definido. Confírmalo a continuación.</p>
              )}
              {backupConfirmStep && !backupConfirmPattern && (
                <p className="mt-1 text-xs text-cyan-400">Paso 2 de 2: confirma el patrón para exportar.</p>
              )}
              {patternError && (
                <p className="mt-1 text-xs text-red-400">{patternError}</p>
              )}
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">{success}</p>}
            <div className="flex space-x-3">
              <button
                onClick={() => void changeMode('select')}
                className="flex-1 px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors"
              >
                Atrás
              </button>
              <button
                onClick={() => {
                  setBackupPattern(null);
                  setBackupConfirmPattern(null);
                  setBackupConfirmStep(false);
                  setBackupPatternReset((k) => k + 1);
                  setPatternError('');
                  setSuccess('');
                }}
                className="flex-1 px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors"
              >
                Limpiar patrón
              </button>
              <button
                onClick={() => void handleExport()}
                disabled={!backupPattern || !backupConfirmPattern}
                className="flex-1 px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Crear respaldo
              </button>
            </div>
          </div>
        )}

        {mode === 'import' && (
          <div className="space-y-4">
            <p className="text-gray-400 mb-4">
              Selecciona un archivo de respaldo para restaurar.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Archivo de respaldo (.vault)
              </label>
              <button
                onClick={handleVaultFileSelect}
                className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 hover:bg-gray-600 transition-colors text-left"
              >
                {selectedFileName || 'Seleccionar archivo...'}
              </button>
              <input
                ref={vaultFileInputRef}
                type="file"
                accept=".vault"
                onChange={(e) => setSelectedFileName(e.target.files?.[0]?.name || '')}
                className="hidden"
              />
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 flex flex-col items-center">
              <p className="text-sm font-medium text-gray-300 mb-1">
                Patrón de desbloqueo del respaldo
              </p>
              <p className="text-xs text-gray-500 mb-2">
                Dibuja el patrón con el que se protegió este archivo.
              </p>
              <GesturePad
                onPatternComplete={(p) => {
                  setImportPattern(p);
                  if (!selectedFileName) {
                    setSuccess('Patrón listo. Selecciona el archivo de respaldo para restaurar.');
                  }
                }}
                minPoints={4}
                resetKey={importPatternReset}
              />
              {importPattern && (
                <p className="mt-1 text-xs text-green-400">✓ Patrón introducido.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Modo de importación
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="merge"
                    checked={importMode === 'merge'}
                    onChange={(e) => setImportMode(e.target.value as ImportMode)}
                    className="mr-2"
                  />
                  <span>Agregar a las existentes (Merge)</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="overwrite"
                    checked={importMode === 'overwrite'}
                    onChange={(e) => setImportMode(e.target.value as ImportMode)}
                    className="mr-2"
                  />
                  <span>Reemplazar todas (Overwrite)</span>
                </label>
              </div>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">{success}</p>}
            <div className="flex space-x-3">
              <button
                onClick={() => void changeMode('select')}
                className="flex-1 px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors"
              >
                Atrás
              </button>
              <button
                onClick={() => {
                  setImportPattern(null);
                  setImportPatternReset((k) => k + 1);
                  setSuccess('');
                }}
                className="flex-1 px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors"
              >
                Limpiar patrón
              </button>
              <button
                onClick={() => void handleImport()}
                disabled={!selectedFileName || !importPattern}
                className="flex-1 px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Restaurar respaldo
              </button>
            </div>
          </div>
        )}

        {mode === 'shareQR' && (
          <div className="space-y-6">
            <p className="text-gray-400">
              Selecciona una o varias contraseñas, dibuja el patrón de desbloqueo de este dispositivo y genera el QR cifrado.
            </p>

            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-4">
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 flex flex-col items-center">
                  <p className="text-sm font-medium text-gray-300 mb-1">
                    Patrón de desbloqueo de este dispositivo
                  </p>
                  <p className="text-xs text-gray-500 mb-2">
                    Dibuja el mismo patrón con el que desbloqueas SecurePass aquí.
                  </p>
                  <GesturePad
                    onPatternComplete={(p) => {
                      setQrSharePattern(p);
                    }}
                    minPoints={4}
                    resetKey={qrSharePatternReset}
                  />
                  {qrSharePattern && (
                    <p className="mt-1 text-xs text-green-400">✓ Patrón listo para generar el QR.</p>
                  )}
                </div>

                <div className="flex items-center justify-between text-sm text-gray-400">
                  <span>Contraseñas disponibles</span>
                  <span>{selectedPasswordIds.length} seleccionadas</span>
                </div>

                {passwords.length === 0 ? (
                  <div className="p-4 rounded-md border border-gray-700 bg-gray-900/60 text-gray-400">
                    No hay contraseñas disponibles para enviar.
                  </div>
                ) : (
                  <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
                    {passwords.map((entry) => {
                      const isSelected = selectedPasswordIds.includes(entry.id);

                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => togglePasswordSelection(entry.id)}
                          className={`w-full text-left p-4 rounded-md border transition-colors ${
                            isSelected
                              ? 'border-cyan-500 bg-cyan-500/10'
                              : 'border-gray-700 bg-gray-900/60 hover:bg-gray-700/40'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-cyan-400">{entry.site}</p>
                              <p className="text-sm text-gray-300">{entry.username}</p>
                              <p className="text-xs text-gray-500 mt-1">{entry.category}</p>
                            </div>
                            <div className={`mt-1 h-5 w-5 rounded border flex items-center justify-center ${isSelected ? 'border-cyan-400 bg-cyan-500/20' : 'border-gray-500'}`}>
                              {isSelected && <span className="text-cyan-300 text-xs">✓</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-gray-900/60 rounded-lg border border-gray-700 p-4 flex flex-col items-center justify-center text-center min-h-[360px]">
                {generatedQRData ? (
                  <>
                    <div className="bg-white p-4 rounded-lg">
                      <div ref={qrCodeContainerRef}>
                        <QRCode value={generatedQRData} size={360} level="M" />
                      </div>
                    </div>
                    <p className="text-sm text-gray-400 mt-4">
                      Este QR contiene solo el payload cifrado. El otro dispositivo necesitará el patrón de desbloqueo de este dispositivo para descifrarlo.
                    </p>
                  </>
                ) : (
                  <p className="text-gray-500">
                    El QR aparecerá aquí cuando generes la transferencia.
                  </p>
                )}
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">{success}</p>}

            <div className="flex space-x-3">
              <button
                onClick={() => void changeMode('select')}
                className="flex-1 px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors"
              >
                Atrás
              </button>
              <button
                onClick={() => {
                  setQrSharePattern(null);
                  setQrSharePatternReset((k) => k + 1);
                  setGeneratedQRData('');
                  setSuccess('');
                }}
                className="flex-1 px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors font-semibold"
              >
                Limpiar patrón
              </button>
              <button
                onClick={() => void handleGenerateQR()}
                disabled={passwords.length === 0 || !qrSharePattern}
                className="flex-1 px-4 py-2 rounded-md bg-purple-600 hover:bg-purple-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generar QR de envío
              </button>
              <button
                onClick={() => void handleSaveQRImage()}
                disabled={!generatedQRData}
                className="flex-1 px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Guardar imagen QR
              </button>
            </div>
          </div>
        )}

        {mode === 'scanQR' && (
          <div className="space-y-5">
            <p className="text-gray-400">
              Recibe contraseñas desde otro dispositivo mediante QR: apunta la cámara o carga una imagen local. Después dibuja el patrón de desbloqueo del dispositivo que envió el QR para descifrarlo.
            </p>

            <div className="grid gap-5 lg:grid-cols-[1.05fr_1.15fr]">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={() => void handleStartCameraScan()}
                    className="w-full px-4 py-3 rounded-md bg-purple-600 hover:bg-purple-700 transition-colors font-semibold"
                  >
                    Usar cámara
                  </button>
                  <button
                    onClick={handleImageFileSelect}
                    className="w-full px-4 py-3 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors font-semibold"
                  >
                    Cargar imagen QR
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
                  <div
                    className={`rounded-lg border border-gray-700 bg-gray-900/60 overflow-hidden ${
                      scanSource === 'camera' && !pendingQRPayload ? 'min-h-[280px]' : ''
                    }`}
                  >
                    <div
                      id={QR_READER_ELEMENT_ID}
                      className="w-full h-full rounded-lg overflow-hidden bg-black"
                    />
                  </div>
                )}

                {pendingQRPayload ? (
                  <div className="flex items-start gap-3 text-sm rounded-md border border-green-500/20 bg-green-500/5 px-4 py-3">
                    <div className="text-green-400 text-xl leading-none mt-0.5">✓</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-100 font-medium">QR leído correctamente</p>
                      {selectedImageName && (
                        <p className="text-gray-500 truncate mt-0.5">
                          {selectedImageName}
                        </p>
                      )}
                    </div>
                  </div>
                ) : scanSource === 'image' && !pendingQRPayload ? (
                  <p className="text-sm text-gray-500 text-center italic px-3">
                    Selecciona una imagen para empezar la lectura del QR.
                  </p>
                ) : !scanSource ? (
                  <p className="text-sm text-gray-500 text-center italic px-3">
                    Elige una fuente para importar el QR.
                  </p>
                ) : null}

                <button
                  onClick={() => void handleRestartQRScan()}
                  className="w-full px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors"
                >
                  Reiniciar lectura QR
                </button>
              </div>

              <div className="space-y-4">
                <div
                  className={`rounded-lg border p-4 flex flex-col items-center ${
                    pendingQRPayload ? 'border-gray-700 bg-gray-900/60' : 'border-gray-700/40 bg-gray-900/20 opacity-70'
                  }`}
                >
                  <p className="text-sm font-medium text-gray-300 mb-1">
                    Patrón de desbloqueo del dispositivo que envió el QR
                  </p>
                  <p className="text-xs text-gray-500 mb-2">
                    {pendingQRPayload
                      ? 'Dibuja el patrón del otro dispositivo para descifrar el QR.'
                      : 'Primero escanea o carga un QR, luego dibuja el patrón.'}
                  </p>
                  <GesturePad
                    onPatternComplete={(p) => setQrImportPattern(p)}
                    minPoints={4}
                    resetKey={qrImportPatternReset}
                    showError={!pendingQRPayload && qrImportPattern !== null ? true : false}
                  />
                  {qrImportPattern && pendingQRPayload && (
                    <p className="mt-1 text-xs text-green-400">✓ Patrón listo. Pulsa "Descifrar QR".</p>
                  )}
                  {!pendingQRPayload && qrImportPattern && (
                    <p className="mt-1 text-xs text-amber-400/90">Patrón introducido. Ahora carga o escanea un QR.</p>
                  )}
                </div>

                <button
                  onClick={() => void handleDecryptScannedQR()}
                  disabled={!pendingQRPayload || !qrImportPattern}
                  className="w-full px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Descifrar QR
                </button>

                {scannedPasswords.length > 0 && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">
                        Modo de importación
                      </label>
                      <div className="space-y-2">
                        <label className="flex items-center">
                          <input
                            type="radio"
                            value="merge"
                            checked={importMode === 'merge'}
                            onChange={(e) => setImportMode(e.target.value as ImportMode)}
                            className="mr-2"
                          />
                          <span>Agregar a las existentes (Merge)</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="radio"
                            value="overwrite"
                            checked={importMode === 'overwrite'}
                            onChange={(e) => setImportMode(e.target.value as ImportMode)}
                            className="mr-2"
                          />
                          <span>Reemplazar todas (Overwrite)</span>
                        </label>
                      </div>
                    </div>

                    <div className="bg-gray-900/60 rounded-lg border border-gray-700 p-4">
                      <p className="text-sm font-medium text-gray-300 mb-3">
                        Vista previa de la importación
                      </p>
                      <div className="max-h-[260px] overflow-y-auto space-y-2">
                        {scannedPasswords.map((entry) => (
                          <div key={entry.id} className="p-3 rounded-md bg-gray-800 border border-gray-700">
                            <p className="font-semibold text-cyan-400">{entry.site}</p>
                            <p className="text-sm text-gray-300">{entry.username}</p>
                            <p className="text-xs text-gray-500 mt-1">{entry.category}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && !pendingQRPayload && <p className="text-green-400 text-sm">{success}</p>}

            <div className="flex space-x-3">
              <button
                onClick={() => void changeMode('select')}
                className="flex-1 px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors"
              >
                Atrás
              </button>
              <button
                onClick={() => {
                  setQrImportPattern(null);
                  setQrImportPatternReset((k) => k + 1);
                  setSuccess('');
                }}
                className="flex-1 px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors font-semibold"
              >
                Limpiar patrón
              </button>
              <button
                onClick={() => void handleImportFromQR()}
                disabled={scannedPasswords.length === 0}
                className="flex-1 px-4 py-2 rounded-md bg-purple-600 hover:bg-purple-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Recibir contraseñas
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportExportModal;
