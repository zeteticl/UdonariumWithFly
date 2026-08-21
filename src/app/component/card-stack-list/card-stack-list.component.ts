import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';

import { Card, CardState } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { EventSystem, Network } from '@udonarium/core/system';
import { I18nService } from 'service/i18n.service';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';

import { CardSettingsComponent } from 'component/card-settings/card-settings.component';
import { ChatMessageService } from 'service/chat-message.service';

import { PanelOption, PanelService } from 'service/panel.service';

@Component({
    selector: 'card-stack-list',
    templateUrl: './card-stack-list.component.html',
    styleUrls: ['./card-stack-list.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class CardStackListComponent implements OnChanges, OnDestroy {
  @Input() cardStack: CardStack = null;

  owner: string = Network.peer.userId;
  
  readonly CardStateFront = CardState.FRONT;
  readonly CardStateBack = CardState.BACK;

  get cards(): Card[] {
    return this.cardStack ? this.cardStack.cards : [];
  }

  constructor(
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private chatMessageService: ChatMessageService,
    private i18n: I18nService
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnChanges() {
    if (!this.cardStack) return;
    Promise.resolve().then(() => {
      if (this.cardStack) this.panelService.title = this.cardStack.name + this.i18n.t('stack.listSuffix');
    });
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.cardStack.identifier}`, event => {
        this.changeDetector.markForCheck();
        if (this.cardStack && this.cardStack.owner !== this.owner) {
          this.panelService.close();
        }
      })
      .on(`UPDATE_OBJECT_CHILDREN/identifier/${this.cardStack.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on('DELETE_GAME_OBJECT', event => {
        if (this.cardStack && this.cardStack.identifier === event.data.identifier) {
          this.panelService.close();
        }
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.cardStack && this.cardStack.owner === this.owner) {
      this.cardStack.owner = '';
    }
  }

  drawCard(card: Card) {
    if (this.GuestMode() || !this.cardStack) return;
    card.parent.removeChild(card);
    card.location.x = this.cardStack.location.x + 100 + (Math.random() * 50);
    card.location.y = this.cardStack.location.y + 25 + (Math.random() * 50);
    card.location.name = this.cardStack.location.name;
    card.tableIdentifier = this.cardStack.location.name === 'table' ? this.cardStack.tableIdentifier : '';
    card.rotate += this.cardStack.rotate;
    if (360 < card.rotate) card.rotate -= 360;
    card.raiseInTier();
    SoundEffect.play(PresetSound.cardDraw);
    const stackName = this.cardStack.name == '' ? this.i18n.t('stack.unnamed') : this.cardStack.name;
    if (card.isFront) {
      const cardName = card.name == '' ? this.i18n.t('card.unnamed') : card.name;
      this.chatMessageService.sendOperationLog(this.i18n.t('stack.takeOut', { stack: stackName, card: cardName }));
    } else {
      this.chatMessageService.sendOperationLog(this.i18n.t('stack.takeOutFacedown', { stack: stackName }));
    }
  } 

  up(card: Card) {
    if (this.GuestMode()) return;
    let parent = card.parent;
    let index: number = parent.children.indexOf(card);
    if (0 < index) {
      let prev = parent.children[index - 1];
      parent.insertBefore(card, prev);
    }
  }

  down(card: Card) {
    if (this.GuestMode()) return;
    let parent = card.parent;
    let index: number = parent.children.indexOf(card);
    if (index < parent.children.length - 1) {
      let next = parent.children[index + 1];
      parent.insertBefore(next, card);
    }
  }

  close(needShuffle: boolean = false) {
    if (this.GuestMode()) return;
    if (needShuffle && this.cardStack) {
      this.cardStack.shuffle();
      EventSystem.call('SHUFFLE_CARD_STACK', { identifier: this.cardStack.identifier });
      SoundEffect.play(PresetSound.cardShuffle);
    }
    this.panelService.close();
  }

  showDetail(gameObject: Card) {
    if (this.GuestMode()) return;
    let title = this.i18n.t('cardList.panelTitle');
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    let coordinate = {
      x: this.panelService.left,
      y: this.panelService.top
    };
    let option: PanelOption = {
      title: title, left: coordinate.x + 10, top: coordinate.y + 20, width: 420, height: 360,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    let component = this.panelService.open<CardSettingsComponent>(CardSettingsComponent, option);
    component.card = gameObject;
  }

  trackByCard(index: number, card: Card) {
    return card.identifier;
  }
}
