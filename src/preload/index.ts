import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { createDesktopApi } from './desktop-api';

const desktopApi = createDesktopApi({
  invoke: (channel: string, request: unknown) => ipcRenderer.invoke(channel, request),
  subscribe: (channel: string, listener: (payload: unknown) => void) => {
    const wrappedListener = (_event: IpcRendererEvent, payload: unknown): void => {
      listener(payload);
    };

    ipcRenderer.on(channel, wrappedListener);

    return (): void => {
      ipcRenderer.removeListener(channel, wrappedListener);
    };
  },
});

contextBridge.exposeInMainWorld('desktop', {
  ...desktopApi,
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
});
