import { Injectable, NgZone } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { EventSystem } from '@udonarium/core/system';
import { I18nService } from './i18n.service';

/**
 * Tracks PWA updates: activate quietly when ready; UI shows a hint.
 * New build is used on the next manual reload / restart (no forced reload).
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  /** True after a new SW version is downloaded and activated for the next load. */
  isUpdateReady = false;
  private started = false;

  constructor(
    private swUpdate: SwUpdate,
    private ngZone: NgZone,
    private i18n: I18nService,
  ) { }

  start() {
    if (this.started || !this.swUpdate.isEnabled) return;
    this.started = true;

    let notification: Notification;
    this.swUpdate.versionUpdates.subscribe(event => {
      switch (event.type) {
        case 'VERSION_DETECTED':
          console.log(`Downloading new app version: ${event.version.hash}`);
          Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
              notification = new Notification('Udonarium with Fly', {
                body: this.i18n.t('update.downloading'),
                icon: 'hktrpg-icon.png'
              });
              notification.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                if (notification) {
                  notification.close();
                  notification = null;
                }
                return false;
              });
            }
          });
          break;
        case 'VERSION_READY':
          console.log(`Current app version: ${(event as VersionReadyEvent).currentVersion.hash}`);
          console.log(`New app version ready for use: ${(event as VersionReadyEvent).latestVersion.hash}`);
          void this.swUpdate.activateUpdate().then(() => {
            if (notification) {
              notification.close();
              notification = null;
            }
            this.ngZone.run(() => {
              this.isUpdateReady = true;
              EventSystem.trigger('APP_UPDATE_READY', null);
              console.log('New app version activated; will apply on next reload / restart.');
            });
          });
          break;
        case 'VERSION_INSTALLATION_FAILED':
          console.log(`Failed to install app version '${event.version.hash}': ${event.error}`);
          break;
      }
    });

    void this.swUpdate.checkForUpdate().catch(err => {
      console.warn('Service worker update check failed', err);
    });
  }
}
