import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppLocale } from 'i18n';
import { GuidedTourService, GuidedTourUiState } from 'service/guided-tour.service';
import { I18nService } from 'service/i18n.service';

@Component({
  selector: 'guided-tour',
  templateUrl: './guided-tour.component.html',
  styleUrls: ['./guided-tour.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class GuidedTourComponent implements OnInit, OnDestroy {
  state: GuidedTourUiState = {
    phase: 'idle',
    stepIndex: -1,
    steps: [],
    current: null,
    actionDone: false,
    hole: null,
    bubbleLeft: 24,
    bubbleTop: 24,
    bubbleWidth: 320,
    isMobile: false,
  };

  private sub: Subscription;

  constructor(
    private tour: GuidedTourService,
    private cd: ChangeDetectorRef,
    public i18n: I18nService,
  ) { }

  ngOnInit() {
    this.sub = this.tour.state$.subscribe(s => {
      this.state = s;
      this.cd.markForCheck();
    });
    this.sub.add(this.i18n.locale$.subscribe(() => this.cd.markForCheck()));
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  get progressLabel(): string {
    if (this.state.phase !== 'running' || this.state.steps.length < 1) return '';
    return `${this.state.stepIndex + 1} / ${this.state.steps.length}`;
  }

  get canNext(): boolean {
    if (this.state.phase === 'welcome') return true;
    return this.state.actionDone || this.state.current?.require === 'ack';
  }

  get stepBodyKey(): string {
    const step = this.state.current;
    if (!step) return '';
    if (this.state.isMobile && step.bodyKeyMobile) return step.bodyKeyMobile;
    return step.bodyKey;
  }

  onLocaleChange(locale: AppLocale) {
    this.i18n.setLocale(locale);
  }

  start() { this.tour.start(); }
  skipAll() { this.tour.skipAll(); }
  skipChapter() { this.tour.skipChapter(); }
  next() { this.tour.next(); }
  prev() { this.tour.prev(); }
}
