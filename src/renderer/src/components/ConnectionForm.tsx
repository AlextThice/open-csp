import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SftpConnectionProfile } from '@shared/models/connection-profile';
import type { WorkspaceRunner } from './useWorkspaceService';
import { Dialog } from './Dialog';

export const ConnectionForm = ({
  profile,
  run,
  onClose,
  errorKey,
}: {
  readonly profile: SftpConnectionProfile | undefined;
  readonly run: WorkspaceRunner;
  readonly onClose: () => void;
  readonly errorKey: string | null;
}) => {
  const { t } = useTranslation();
  const [authMode, setAuthMode] = useState(profile?.authentication.method ?? 'password');
  const [isSaving, setIsSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const data = new FormData(form);
    const secretInput = form.elements.namedItem('secret') as HTMLInputElement;
    const secret = secretInput.value;
    secretInput.value = '';
    setIsSaving(true);
    const result = await run({
      action: 'save-profile',
      profile: {
        id: profile?.id ?? null,
        name: String(data.get('name')),
        host: String(data.get('host')),
        port: Number(data.get('port')),
        username: String(data.get('username')),
        initialDirectory: String(data.get('initialDirectory')),
        timeout: Number(data.get('timeout')),
        keepalive: Number(data.get('keepalive')),
        authMode,
        privateKeyPath: keyInput.current?.value ?? '',
      },
      ...(secret === '' || authMode === 'agent' ? {} : { secret }),
    });
    setIsSaving(false);
    if (result) onClose();
  };
  return (
    <Dialog title={t('connections.profile')} onClose={onClose}>
      {errorKey ? <div role="alert">{t(errorKey)}</div> : null}
      {invalid ? <p role="alert">{t('library.validation')}</p> : null}
      <form noValidate onSubmit={(event) => void save(event)}>
        <label>
          {t('connections.name')}
          <input autoFocus defaultValue={profile?.name ?? ''} name="name" required />
        </label>
        <label>
          {t('connections.host')}
          <input defaultValue={profile?.host ?? ''} name="host" required />
        </label>
        <label>
          {t('connections.port')}
          <input
            defaultValue={profile?.port ?? 22}
            max={65535}
            min={1}
            name="port"
            required
            type="number"
          />
        </label>
        <label>
          {t('connections.username')}
          <input
            autoComplete="username"
            defaultValue={profile?.username ?? ''}
            name="username"
            required
          />
        </label>
        <label>
          {t('connections.authMode')}
          <select
            value={authMode}
            onChange={(event) => setAuthMode(event.currentTarget.value as typeof authMode)}
          >
            <option value="password">{t('connections.password')}</option>
            <option value="private-key">{t('connections.privateKey')}</option>
            <option value="agent">{t('connections.agent')}</option>
          </select>
        </label>
        <label hidden={authMode !== 'private-key'}>
          {t('connections.privateKey')}
          <input
            defaultValue={
              profile?.authentication.method === 'private-key'
                ? profile.authentication.privateKeyPath
                : ''
            }
            name="privateKeyPath"
            ref={keyInput}
          />
          <button
            type="button"
            onClick={() =>
              void run({ action: 'pick-private-key' }).then((result) => {
                if (result?.privateKeyPath && keyInput.current)
                  keyInput.current.value = result.privateKeyPath;
              })
            }
          >
            {t('connections.browse')}
          </button>
        </label>
        <label hidden={authMode === 'agent'}>
          {t(authMode === 'private-key' ? 'connections.passphrase' : 'connections.password')}
          <input autoComplete="off" name="secret" type="password" />
        </label>
        <small>{t('connections.secretHint')}</small>
        <label>
          {t('connections.initialDirectory')}
          <input defaultValue={profile?.initialDirectory ?? '/'} name="initialDirectory" required />
        </label>
        <label>
          {t('connections.timeout')}
          <input
            defaultValue={profile?.timeout ?? 20000}
            min={1000}
            max={120000}
            name="timeout"
            type="number"
            required
          />
        </label>
        <label>
          {t('connections.keepalive')}
          <input
            defaultValue={profile?.keepalive ?? 10000}
            min={1000}
            max={120000}
            name="keepalive"
            type="number"
            required
          />
        </label>
        <div className="dialog-actions">
          <button disabled={isSaving} type="submit">
            {t('connections.save')}
          </button>
          <button disabled={isSaving} type="button" onClick={onClose}>
            {t('connections.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
