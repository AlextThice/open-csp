import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import { useWorkspaceService } from './useWorkspaceService';
import { ConnectionForm } from './ConnectionForm';
import { S3ConnectionForm } from './S3ConnectionForm';

export const ProfileLibrary = ({ onClose }: { readonly onClose: () => void }) => {
  const { t } = useTranslation();
  const service = useWorkspaceService(true);
  const { snapshot, run, errorKey } = service;
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('*');
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState<
    'import-profiles' | 'import-known-hosts' | 'export' | 'delete' | 'copy' | null
  >(null);
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [exportKind, setExportKind] = useState<'profiles' | 'diagnostics'>('profiles');
  const [edit, setEdit] = useState(false);
  const profile = snapshot.profiles.find((item) => item.id === selected);
  const groups = [...new Set(Object.values(snapshot.profileGroups ?? {}))].sort();
  const filtered = snapshot.profiles.filter(
    (item) =>
      `${item.kind} ${item.name} ${item.kind === 'sftp' ? item.host : (item.endpoint ?? '')}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()) &&
      (group === '*' || (snapshot.profileGroups?.[item.id] ?? '') === group),
  );
  const exported = async (kind: 'profiles' | 'diagnostics') => {
    const result = await run({
      action: kind === 'profiles' ? 'export-profiles' : 'export-diagnostics',
    });
    if (result?.document) {
      setContent(result.document);
      setMode('export');
      setExportKind(kind);
      setSummary(t('library.exportReady'));
    }
  };
  return (
    <Dialog title={t('library.title')} onClose={onClose}>
      <div className="library-controls">
        <input
          aria-label={t('library.search')}
          placeholder={t('library.search')}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <select
          aria-label={t('library.group')}
          value={group}
          onChange={(event) => setGroup(event.currentTarget.value)}
        >
          <option value="*">{t('library.all')}</option>
          {groups.map((name) => (
            <option key={name} value={name}>
              {name || t('library.ungrouped')}
            </option>
          ))}
        </select>
        <select
          size={5}
          aria-label={t('s3.selector')}
          value={selected}
          onChange={(event) => {
            setSelected(event.currentTarget.value);
            setMode(null);
          }}
        >
          {filtered.map((item) => (
            <option key={item.id} value={item.id}>
              {item.kind.toUpperCase()} · {item.name} ·{' '}
              {snapshot.profileGroups?.[item.id] || t('library.ungrouped')}
            </option>
          ))}
        </select>
        <div className="dialog-actions">
          <button disabled={!profile} onClick={() => setEdit(true)}>
            {t('connections.edit')}
          </button>
          <button disabled={!profile} onClick={() => setMode('copy')}>
            {t('library.copy')}
          </button>
          <button disabled={!profile} onClick={() => setMode('delete')}>
            {t('library.remove')}
          </button>
        </div>
        {profile ? (
          <form
            key={profile.id}
            className="path-entry"
            onSubmit={(event) => {
              event.preventDefault();
              void run({
                action: 'set-profile-group',
                profileId: profile.id,
                group: String(new FormData(event.currentTarget).get('group')),
              });
            }}
          >
            <input
              name="group"
              aria-label={t('library.group')}
              maxLength={100}
              defaultValue={snapshot.profileGroups?.[profile.id] ?? ''}
            />
            <button>{t('library.renameGroup')}</button>
          </form>
        ) : null}
        <p>{t('library.archiveWarning')}</p>
        <div className="dialog-actions">
          <button onClick={() => void exported('profiles')}>{t('library.export')}</button>
          <button
            onClick={() => {
              setMode('import-profiles');
              setContent('');
              setSummary('');
            }}
          >
            {t('library.import')}
          </button>
          <button
            onClick={() => {
              setMode('import-known-hosts');
              setContent('');
              setSummary('');
            }}
          >
            {t('library.knownHosts')}
          </button>
        </div>
        <details>
          <summary>{t('library.diagnostics')}</summary>
          <p>{t('library.diagnosticsHint')}</p>
          <button onClick={() => void exported('diagnostics')}>{t('library.report')}</button>
        </details>
      </div>
      {mode === 'copy' && profile ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run({
              action: 'clone-profile',
              profileId: profile.id,
              name: String(new FormData(event.currentTarget).get('name')),
            }).then((result) => {
              if (result) setMode(null);
            });
          }}
        >
          <label>
            {t('library.copyName')}
            <input
              autoFocus
              name="name"
              required
              maxLength={200}
              defaultValue={`${profile.name} — ${t('library.copied')}`}
            />
          </label>
          <button>{t('operations.confirm')}</button>
        </form>
      ) : null}
      {mode === 'delete' && profile ? (
        <section>
          <p>
            {t('library.removeWarning')} {profile.name}
          </p>
          <button
            onClick={() =>
              void run({ action: 'delete-profile', profileId: profile.id }).then((result) => {
                if (result) {
                  setMode(null);
                  setSelected('');
                }
              })
            }
          >
            {t('operations.confirm')}
          </button>
          <button onClick={() => setMode(null)}>{t('connections.cancel')}</button>
        </section>
      ) : null}
      {mode === 'import-profiles' || mode === 'import-known-hosts' || mode === 'export' ? (
        <section>
          {mode === 'import-known-hosts' ? <p>{t('library.importWarning')}</p> : null}
          {mode !== 'export' ? (
            <label>
              {t('library.chooseFile')}
              <input
                type="file"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file && file.size <= 1048576) void file.text().then(setContent);
                  else setSummary(t('library.validation'));
                }}
              />
            </label>
          ) : null}
          <label>
            {t('library.content')}
            <textarea
              rows={8}
              maxLength={1048576}
              value={content}
              readOnly={mode === 'export'}
              onChange={(event) => setContent(event.currentTarget.value)}
            />
          </label>
          {mode === 'export' ? (
            <button onClick={() => void run({ action: 'save-export', kind: exportKind })}>
              {t('library.saveFile')}
            </button>
          ) : (
            <button
              disabled={!content}
              onClick={() =>
                void run({ action: mode, content }).then((result) => {
                  if (result?.importSummary) {
                    setSummary(t('library.summary', result.importSummary));
                    setContent('');
                  }
                })
              }
            >
              {t('library.importConfirm')}
            </button>
          )}
        </section>
      ) : null}
      {summary ? <p role="status">{summary}</p> : null}
      {errorKey ? <p role="alert">{t(errorKey)}</p> : null}
      <div className="dialog-actions">
        <button onClick={onClose}>{t('library.close')}</button>
      </div>
      {edit && profile ? (
        profile.kind === 'sftp' ? (
          <ConnectionForm
            profile={profile}
            run={run}
            errorKey={errorKey}
            onClose={() => setEdit(false)}
          />
        ) : (
          <S3ConnectionForm
            profile={profile}
            run={run}
            errorKey={errorKey}
            onClose={() => setEdit(false)}
          />
        )
      ) : null}
    </Dialog>
  );
};
