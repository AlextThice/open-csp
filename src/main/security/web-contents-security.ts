export interface CancellableNavigationEvent {
  readonly preventDefault: () => void;
}

export interface SecureWebContents {
  readonly onWillNavigate: (
    listener: (event: CancellableNavigationEvent, url: string) => void,
  ) => void;
  readonly onWillRedirect: (
    listener: (event: CancellableNavigationEvent, url: string) => void,
  ) => void;
  readonly setWindowOpenHandler: (handler: (url: string) => { readonly action: 'deny' }) => void;
}

export const configureWebContentsSecurity = (webContents: SecureWebContents): void => {
  webContents.onWillNavigate((event: CancellableNavigationEvent) => {
    event.preventDefault();
  });

  webContents.onWillRedirect((event: CancellableNavigationEvent) => {
    event.preventDefault();
  });

  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
};
