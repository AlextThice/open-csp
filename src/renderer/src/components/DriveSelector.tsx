import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalDrive } from '@shared/ipc/contracts';
import { useTranslation } from 'react-i18next';

export interface DriveSelectorProps {
  readonly currentRootPath: string | undefined;
  readonly isActive: boolean;
  readonly onNavigate: (path: string) => void;
}

export const DriveSelector = ({ currentRootPath, isActive, onNavigate }: DriveSelectorProps) => {
  const { t } = useTranslation();
  const [drives, setDrives] = useState<readonly LocalDrive[]>([]);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const requestVersion = useRef(0);

  const refreshDrives = useCallback(async (): Promise<void> => {
    const version = ++requestVersion.current;
    setIsLoading(true);
    const response = await window.desktop.listLocalDrives();

    if (version !== requestVersion.current) {
      return;
    }

    if (response.ok) {
      setDrives(response.data);
    }

    setHasError(!response.ok);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (isActive) {
      void refreshDrives();
    }

    return () => {
      requestVersion.current += 1;
    };
  }, [isActive, refreshDrives]);

  const selectedDrive = drives.find(
    (drive) =>
      drive.path === currentRootPath ||
      (/^[a-z]:\\$/iu.test(drive.path) &&
        drive.path.toLowerCase() === currentRootPath?.toLowerCase()),
  );

  return (
    <div className="drive-selector">
      <select
        aria-label={t('drives.label')}
        onChange={(event) => onNavigate(event.currentTarget.value)}
        title={currentRootPath ?? t('drives.label')}
        value={selectedDrive?.path ?? currentRootPath ?? ''}
      >
        {currentRootPath === undefined ? (
          <option disabled value="">
            {isLoading ? t('drives.loading') : t('drives.choose')}
          </option>
        ) : null}
        {currentRootPath !== undefined && selectedDrive === undefined ? (
          <option disabled value={currentRootPath}>
            {currentRootPath}
          </option>
        ) : null}
        {drives.map((drive) => (
          <option key={drive.path} value={drive.path}>
            {drive.label}
          </option>
        ))}
      </select>
      <button
        aria-label={t('drives.refresh')}
        className="icon-button"
        disabled={isLoading}
        onClick={() => void refreshDrives()}
        title={t('drives.refresh')}
        type="button"
      >
        <span aria-hidden="true">⟳</span>
      </button>
      {hasError ? (
        <span className="drive-selector__error" role="alert" title={t('drives.error')}>
          {t('drives.error')}
        </span>
      ) : null}
    </div>
  );
};
