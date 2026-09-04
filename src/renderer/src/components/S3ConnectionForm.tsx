import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { S3ConnectionProfile } from '@shared/models/connection-profile';
import type { WorkspaceRunner } from './useWorkspaceService';
import { Dialog } from './Dialog';

export const S3ConnectionForm = ({
  profile,
  run,
  onClose,
  errorKey,
}: {
  readonly profile: S3ConnectionProfile | undefined;
  readonly run: WorkspaceRunner;
  readonly onClose: () => void;
  readonly errorKey: string | null;
}) => {
  const { t } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const data = new FormData(form);
    const keyInput = form.elements.namedItem('secretAccessKey') as HTMLInputElement;
    const tokenInput = form.elements.namedItem('sessionToken') as HTMLInputElement;
    const secretAccessKey = keyInput.value;
    const sessionToken = tokenInput.value;
    keyInput.value = '';
    tokenInput.value = '';
    setIsSaving(true);
    const result = await run({
      action: 'save-s3-profile',
      profile: {
        id: profile?.id ?? null,
        name: String(data.get('name')),
        endpoint: String(data.get('endpoint')).trim(),
        region: String(data.get('region')),
        bucket: String(data.get('bucket')).trim(),
        initialPrefix: String(data.get('initialPrefix')),
        accessKeyId: String(data.get('accessKeyId')),
        forcePathStyle: data.get('forcePathStyle') === 'on',
      },
      ...(secretAccessKey ? { secretAccessKey } : {}),
      ...(sessionToken || data.get('clearToken') === 'on' ? { sessionToken } : {}),
    });
    setIsSaving(false);
    if (result) onClose();
  };
  return (
    <Dialog title={t('s3.profile')} onClose={onClose}>
      <p>{t('s3.endpointHint')}</p>
      {errorKey ? <div role="alert">{t(errorKey)}</div> : null}
      {invalid ? <p role="alert">{t('library.validation')}</p> : null}
      <form noValidate onSubmit={(event) => void save(event)}>
        <label>
          {t('connections.name')}
          <input autoFocus name="name" required defaultValue={profile?.name ?? ''} />
        </label>
        <label>
          {t('s3.endpoint')}
          <input name="endpoint" type="url" defaultValue={profile?.endpoint ?? ''} />
        </label>
        <label>
          {t('s3.region')}
          <input name="region" required defaultValue={profile?.region ?? 'us-east-1'} />
        </label>
        <label>
          {t('s3.bucket')}
          <input name="bucket" defaultValue={profile?.bucket ?? ''} />
        </label>
        <label>
          {t('s3.initialPrefix')}
          <input name="initialPrefix" defaultValue={profile?.initialPrefix ?? ''} />
        </label>
        <label>
          {t('s3.pathStyle')}
          <input
            name="forcePathStyle"
            type="checkbox"
            defaultChecked={profile?.forcePathStyle ?? false}
          />
        </label>
        <label>
          {t('s3.accessKeyId')}
          <input
            name="accessKeyId"
            required
            autoComplete="off"
            defaultValue={profile?.accessKeyId ?? ''}
          />
        </label>
        <label>
          {t('s3.secretAccessKey')}
          <input
            name="secretAccessKey"
            type="password"
            autoComplete="off"
            required={!profile?.secret}
          />
        </label>
        <label>
          {t('s3.sessionToken')}
          <input name="sessionToken" type="password" autoComplete="off" />
        </label>
        {profile ? (
          <label>
            {t('s3.clearToken')}
            <input name="clearToken" type="checkbox" />
          </label>
        ) : null}
        <small>{t('connections.secretHint')}</small>
        <div className="dialog-actions">
          <button type="submit" disabled={isSaving}>
            {t('connections.save')}
          </button>
          <button type="button" disabled={isSaving} onClick={onClose}>
            {t('connections.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
