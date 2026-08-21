import { Injectable, NgZone } from '@angular/core';
import { setZeroTimeout } from '@udonarium/core/system/util/zero-timeout';

type BatchTask = () => void;

@Injectable({
  providedIn: 'root'
})
export class BatchService {
  private batchTask: Map<any, BatchTask> = new Map();
  private batchTaskTimer: NodeJS.Timeout = null;
  private needsChangeDetection: boolean = false;

  constructor(
    private ngZone: NgZone,
  ) { }

  add(task: BatchTask, key: any = {}) {
    this.batchTask.set(key, task);
    this.startTimer();
  }

  remove(key: any = {}) {
    this.batchTask.delete(key);
  }

  requireChangeDetection() {
    this.needsChangeDetection = true;
    this.startTimer();
  }

  /** Run pending tasks immediately (e.g. before map switch so poses land on the right table). */
  flushNow() {
    if (this.batchTaskTimer != null) {
      clearInterval(this.batchTaskTimer);
      this.batchTaskTimer = null;
    }
    if (this.batchTask.size < 1 && !this.needsChangeDetection) return;
    this.execBatch();
  }

  private startTimer() {
    if (this.batchTaskTimer != null) return;
    this.ngZone.runOutsideAngular(() => {
      setZeroTimeout(() => this.execBatch());
      this.batchTaskTimer = setInterval(() => {
        if (0 < this.batchTask.size) {
          this.execBatch();
        } else {
          clearInterval(this.batchTaskTimer);
          this.batchTaskTimer = null;
        }
      }, 66);
    });
  }

  private execBatch() {
    this.batchTask.forEach(task => task());
    this.batchTask.clear();
    if (this.needsChangeDetection) {
      this.needsChangeDetection = false;
      this.ngZone.run(() => { });
    }
  }
}
