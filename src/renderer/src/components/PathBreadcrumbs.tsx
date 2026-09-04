import type { LocalBreadcrumb } from '@shared/ipc/contracts';
import { useTranslation } from 'react-i18next';

export interface PathBreadcrumbsProps {
  readonly breadcrumbs: readonly LocalBreadcrumb[];
  readonly onNavigate: (path: string) => void;
  readonly onNavigateUp: () => void;
  readonly onRefresh: () => void;
  readonly parentPath: string | null;
}

export const PathBreadcrumbs = ({
  breadcrumbs,
  onNavigate,
  onNavigateUp,
  onRefresh,
  parentPath,
}: PathBreadcrumbsProps) => {
  const { t } = useTranslation();

  return (
    <div className="path-navigation">
      <button
        aria-label={t('path.up')}
        className="icon-button"
        disabled={parentPath === null}
        onClick={onNavigateUp}
        type="button"
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        aria-label={t('toolbar.refresh')}
        className="icon-button"
        onClick={onRefresh}
        type="button"
      >
        <span aria-hidden="true">↻</span>
      </button>
      <nav aria-label={t('path.label')} className="breadcrumbs" data-testid="breadcrumbs">
        {breadcrumbs.map((breadcrumb, index) => (
          <span className="breadcrumb" key={breadcrumb.path}>
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            <button onClick={() => onNavigate(breadcrumb.path)} type="button">
              {breadcrumb.label}
            </button>
          </span>
        ))}
      </nav>
    </div>
  );
};
