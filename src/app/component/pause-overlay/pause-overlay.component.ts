import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { TableSelecter } from '@udonarium/table-selecter';

@Component({
  selector: 'pause-overlay',
  templateUrl: './pause-overlay.component.html',
  styleUrls: ['./pause-overlay.component.css'],
  standalone: false,
})
export class PauseOverlayComponent implements OnInit, OnDestroy {
  constructor(private changeDetector: ChangeDetectorRef) {}

  ngOnInit() {
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        if (event.data?.identifier === 'TableSelecter') {
          this.changeDetector.detectChanges();
        }
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  get visible(): boolean {
    return !!TableSelecter.instance.isPaused;
  }
}
