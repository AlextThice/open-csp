import { Menu } from 'electron';
import { menuResources } from '@shared/localization/menu-resources';

export const setApplicationLanguage = (language: 'en' | 'ru'): void => {
  const labels = menuResources[language];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: labels.file, submenu: [{ role: 'quit', label: labels.quit }] },
      {
        label: labels.edit,
        submenu: (['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] as const).map((role) => ({
          role,
          label: labels[role],
        })),
      },
      {
        label: labels.view,
        submenu: (['resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen'] as const).map((role) => ({
          role,
          label: labels[role],
        })),
      },
    ]),
  );
};
