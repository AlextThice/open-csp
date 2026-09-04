import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export const Dialog = ({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) => {
  const reference = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = reference.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={reference}
      className="connection-dialog native-dialog"
      aria-label={title}
      onInvalidCapture={(event) => {
        event.preventDefault();
        setInvalid(true);
      }}
      onInputCapture={() => setInvalid(false)}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{title}</h2>
      {invalid ? <p role="alert">{t('library.validation')}</p> : null}
      {children}
    </dialog>
  );
};
