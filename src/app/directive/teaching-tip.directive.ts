import { Directive, ElementRef, Input, NgZone, OnDestroy, OnInit } from '@angular/core';
import { TeachingTipService } from 'service/teaching-tip.service';

@Directive({
  selector: '[appTeachingTip]',
  standalone: false,
})
export class TeachingTipDirective implements OnInit, OnDestroy {
  @Input('appTeachingTip') tipKey = '';

  private readonly onEnter = () => {
    // Coarse / touch pointers synthesize sticky mouseenter after tap — never show tips then.
    if (!this.service.isAvailable) return;
    this.service.show(this.tipKey, this.el.nativeElement);
  };
  private readonly onLeave = () => this.service.hide(this.el.nativeElement);
  private readonly onDown = () => this.service.hideAll();

  constructor(
    private el: ElementRef<HTMLElement>,
    private service: TeachingTipService,
    private ngZone: NgZone,
  ) { }

  ngOnInit() {
    this.ngZone.runOutsideAngular(() => {
      this.el.nativeElement.addEventListener('mouseenter', this.onEnter);
      this.el.nativeElement.addEventListener('mouseleave', this.onLeave);
      this.el.nativeElement.addEventListener('pointerdown', this.onDown);
    });
  }

  ngOnDestroy() {
    this.el.nativeElement.removeEventListener('mouseenter', this.onEnter);
    this.el.nativeElement.removeEventListener('mouseleave', this.onLeave);
    this.el.nativeElement.removeEventListener('pointerdown', this.onDown);
    this.service.hide(this.el.nativeElement);
  }
}
