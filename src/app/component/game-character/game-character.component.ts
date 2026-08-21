import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  NgZone,
  ViewChild, ElementRef, AfterViewInit,
  OnChanges,
  OnDestroy
} from '@angular/core';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { EventSystem, Network } from '@udonarium/core/system';
import { MathUtil } from '@udonarium/core/system/util/math-util';
import { GameCharacter } from '@udonarium/game-character';
import { CharacterToken } from '@udonarium/character-token';
import { layerPeerMovableTransform } from '@udonarium/tabletop-object-util';
import { TabletopObject } from '@udonarium/tabletop-object';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { ChatPaletteComponent } from 'component/chat-palette/chat-palette.component';
import { CharacterSettingsComponent } from 'component/character-settings/character-settings.component';
import { MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService, contextMenuToggleCheck } from 'service/context-menu.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { PeerCursor } from '@udonarium/peer-cursor';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { TabletopLoadSettle } from '@udonarium/tabletop-load-settle';
import { shouldIgnoreTabletopDoubleClick } from '@udonarium/tabletop-interact';
import { ModalService } from 'service/modal.service';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { StandSettingComponent } from 'component/stand-setting/stand-setting.component';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';
import { CharacterFxMenuService } from 'service/character-fx-menu.service';
import { CharacterStatusId, getStatusDef } from '@udonarium/table-fx/character-status';
import { CombatTracker } from '@udonarium/table-fx/combat-tracker';
import { buildMatrixRainColumns, imageEffectFilter, imageEffectOpacity, imageEffectTransform, MatrixRainColumn } from '@udonarium/table-fx/image-effect';
import { pushPinAssetUrl } from '@udonarium/table-fx/push-pin.util';
import { I18nService } from 'service/i18n.service';
import { folderBackupDebug } from 'service/folder-backup-debug';
import { TabletopActionService } from 'service/tabletop-action.service';
import { nameTagShouldWrap, NAME_TAG_WRAP_WIDTH_PX } from './name-tag-width';

@Component({
    selector: 'game-character',
    templateUrl: './game-character.component.html',
    styleUrls: ['./game-character.component.css', '../shared/image-effects.css', '../shared/clue-board.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    animations: [
        trigger('switchImage', [
            transition(':increment, :decrement', [
                animate('400ms ease', keyframes([
                    style({ transform: 'scale3d(0.8, 0.8, 0.8) rotateY(0deg)' }),
                    style({ transform: 'scale3d(1.2, 1.2, 1.2) rotateY(180deg)' }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0) rotateY(360deg)' })
                ]))
            ])
        ]),
        trigger('switchImageShadow', [
            transition(':increment, :decrement', [
                animate('400ms ease', keyframes([
                    style({ transform: 'scale3d(0.8, 0.8, 0.8)' }),
                    style({ transform: 'scale3d(0, 1.2, 1.2)' }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)' })
                ]))
            ])
        ]),
        trigger('switchImagePedestal', [
            transition(':increment, :decrement', [
                animate('400ms ease', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)' }),
                    style({ transform: 'scale3d(1.2, 1.2, 1.2)' }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)' })
                ]))
            ])
        ]),
        trigger('bounceInOut', [
            transition('void => *', [
                animate('600ms ease', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)', offset: 0 }),
                    style({ transform: 'scale3d(1.5, 1.5, 1.5)', offset: 0.5 }),
                    style({ transform: 'scale3d(0.75, 0.75, 0.75)', offset: 0.75 }),
                    style({ transform: 'scale3d(1.125, 1.125, 1.125)', offset: 0.875 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)', offset: 1.0 })
                ]))
            ]),
            transition('* => void', [
                animate(100, style({ transform: 'scale3d(0, 0, 0)' }))
            ])
        ]),
        trigger('fadeAndScaleInOut', [
            transition('void => *, true => false', [
                animate('200ms ease-in-out', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)', opacity: 0 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)', opacity: 0.8 }),
                ]))
            ]),
            transition('* => void, true => false', [
                animate('100ms ease-in-out', style({ transform: 'scale3d(0, 0, 0)', opacity: 0 }))
            ])
        ])
    ],
    standalone: false
})
export class GameCharacterComponent implements OnChanges, AfterViewInit, OnDestroy {
  /**
   * @deprecated Prefer TabletopLoadSettle.skipEnterAnimation for load/join.
   * Kept for brief map-switch suppress via TabletopLoadSettle.suppressBriefly.
   */
  static suppressEnterBounce = false;
  /** Coalesce out-of-zone AFTER_VIEW_TABLE_CHANGE into one NgZone kick (avoid N×tick). */
  private static viewTableKickScheduled = false;
  /** Rate-limit mount debug during archive remount storms. */
  private static mountLogBudget = 0;

  /** Call when starting a remount wave so first N mounts are logged. */
  static resetMountLogBudget(n = 16) {
    GameCharacterComponent.mountLogBudget = n;
  }

  @Input() gameCharacter: GameCharacter = null;
  /** When set, this component is a map token projection; sheet data comes from {@link gameCharacter}. */
  @Input() characterToken: CharacterToken = null;
  @Input() is3D: boolean = false;

  /** Object that owns table pose / layer (token when present). */
  get tablePiece(): TabletopObject {
    return this.characterToken || this.gameCharacter;
  }

  /**
   * Stealth / FoW ranges / table cosmetics host.
   * Sheet fields (name size image status chat) stay on {@link gameCharacter}.
   */
  get appearanceHost(): GameCharacter | CharacterToken {
    return CharacterToken.appearanceHostFor(this.gameCharacter, {
      preferredToken: this.characterToken,
    }) || this.gameCharacter;
  }

  get skipEnterBounce(): boolean {
    return TabletopLoadSettle.skipEnterAnimation || GameCharacterComponent.suppressEnterBounce;
  }

  get name(): string {
    if (this.characterToken?.displayNameOverride) return this.characterToken.displayNameOverride;
    return this.gameCharacter?.name || '';
  }
  get size(): number { return MathUtil.clampMin(this.gameCharacter?.size ?? 1); }
  get altitude(): number { return this.appearanceHost?.altitude ?? 0; }
  set altitude(altitude: number) {
    if (!this.appearanceHost) return;
    this.appearanceHost.altitude = altitude;
  }
  get height(): number { return MathUtil.clampMin(this.gameCharacter?.height ?? 0); }
  /** Room 2D mode: face-up token centered on the pedestal (top-down). */
  get is2DMode(): boolean { return !!TableSelecter.instance?.viewTable?.is2DMode; }
  get uprightTransform(): string {
    if (this.is2DMode) {
      // Must set an inline transform so CSS rotateX(-90deg) on .upright-transform
      // does not stand the token up. Ignore SyncVar altitude on corkboard.
      return 'translateZ(0px)';
    }
    const alt = (-this.altitude) * this.gridSize;
    return `rotateY(90deg) rotateZ(-90deg) rotateY(-90deg) translateY(-50%) translateY(${alt}px)`;
  }

  /**
   * Local-only pedestal tip from Terrain.floorHitAt (skybridge).
   * Does not write SyncVar pitch/roll. Refreshed on own pose / move and when terrain SyncVars update.
   */
  get slopeAlignTransform(): string {
    if (this.is2DMode) return '';
    return this._slopeAlignCss;
  }
  private _slopeAlignCss = '';

  private refreshSlopeAlign() {
    if (this.is2DMode) {
      if (this._slopeAlignCss) this._slopeAlignCss = '';
      return;
    }
    const piece = this.tablePiece ?? this.appearanceHost;
    if (!piece || piece.location?.name !== 'table') {
      if (this._slopeAlignCss) this._slopeAlignCss = '';
      return;
    }
    const terrains = TableSelecter.instance?.viewTable?.terrains;
    if (!terrains?.length) {
      if (this._slopeAlignCss) this._slopeAlignCss = '';
      return;
    }
    const size = this.size || 1;
    const g = this.gridSize;
    const hit = Terrain.floorHitAt(
      terrains,
      piece.location.x + (size * g) / 2,
      piece.location.y + (size * g) / 2,
      g,
    );
    const next = hit?.alignCss || '';
    if (next !== this._slopeAlignCss) this._slopeAlignCss = next;
  }

  
  get imageFile(): ImageFile { return this.gameCharacter?.imageFile ?? ImageFile.Empty; }
  get rotate(): number {
    return this.appearanceHost?.rotate ?? 0;
  }
  set rotate(rotate: number) {
    const piece = this.appearanceHost;
    if (!piece) return;
    piece.mutateAppearance(() => { piece.rotate = rotate; });
  }
  /** 2D mode: roll SyncVar is forced to 0 (no tip/tilt). */
  get roll(): number {
    if (this.is2DMode) return 0;
    return (this.appearanceHost as any)?.roll ?? 0;
  }
  set roll(roll: number) {
    if (this.is2DMode) {
      // Display-only: never wipe the shared SyncVar (other maps keep their tip).
      return;
    }
    const piece = this.appearanceHost;
    if (!piece) return;
    piece.mutateAppearance(() => { (piece as any).roll = roll; });
  }
  get isRollLocked(): boolean { return this.is2DMode || this.isMoveLocked; }

  /** 2D display ignores tip; do not mutate SyncVar (would destroy 3D map roll). */
  private enforce2DRollZero() {
    // no-op — getter already returns 0 in 2D
  }
  get isDropShadow(): boolean { return !!this.appearanceHost?.isDropShadow; }
  set isDropShadow(isDropShadow: boolean) {
    const host = this.appearanceHost;
    if (!host) return;
    host.mutateAppearance(() => { host.isDropShadow = isDropShadow; });
  }
  get isAltitudeIndicate(): boolean { return !!this.appearanceHost?.isAltitudeIndicate; }
  set isAltitudeIndicate(isAltitudeIndicate: boolean) {
    const host = this.appearanceHost;
    if (!host) return;
    host.mutateAppearance(() => { host.isAltitudeIndicate = isAltitudeIndicate; });
  }
  get isInverse(): boolean { return !!this.appearanceHost?.isInverse; }
  set isInverse(isInverse: boolean) {
    const host = this.appearanceHost;
    if (!host) return;
    host.mutateAppearance(() => { host.isInverse = isInverse; });
  }
  get isHollow(): boolean { return !!this.appearanceHost?.isHollow; }
  set isHollow(isHollow: boolean) {
    const host = this.appearanceHost;
    if (!host) return;
    host.mutateAppearance(() => { host.isHollow = isHollow; });
  }
  get isBlackPaint(): boolean { return !!this.appearanceHost?.isBlackPaint; }
  set isBlackPaint(isBlackPaint: boolean) {
    const host = this.appearanceHost;
    if (!host) return;
    host.mutateAppearance(() => { host.isBlackPaint = isBlackPaint; });
  }

  private imageEffectSource() {
    const host = this.appearanceHost;
    return {
      isInverse: !!host?.isInverse,
      isHollow: !!host?.isHollow,
      isBlackPaint: !!host?.isBlackPaint,
      isGrayscale: !!host?.isGrayscale,
      isSepia: !!host?.isSepia,
      isWhitePaint: !!host?.isWhitePaint,
      isMatrix: !!host?.isMatrix,
      isFlipVertical: !!host?.isFlipVertical,
      isContrast: !!host?.isContrast,
      isDead: this.hasDeadStatus,
    };
  }
  get imageEffectFilter(): string | null { return imageEffectFilter(this.imageEffectSource()); }
  get imageEffectTransform(): string | null { return imageEffectTransform(this.imageEffectSource()); }
  get imageEffectOpacity(): number | null { return imageEffectOpacity(this.imageEffectSource()); }

  private _matrixRainCacheKey = '';
  private _matrixRainColumns: MatrixRainColumn[] = [];
  get matrixRainColumns(): MatrixRainColumn[] {
    const host = this.appearanceHost;
    if (!host?.isMatrix) return [];
    const w = this.characterImageWidth || this.size * this.gridSize;
    const count = Math.max(4, Math.min(16, Math.round(w / 9)));
    const key = `${host.identifier}:${count}`;
    if (key !== this._matrixRainCacheKey) {
      this._matrixRainCacheKey = key;
      this._matrixRainColumns = buildMatrixRainColumns(key, count);
    }
    return this._matrixRainColumns;
  }
  trackByMatrixCol = (_: number, col: MatrixRainColumn) => `${col.duration}:${col.delay}:${col.text.length}`;

  get aura(): number { return this.appearanceHost?.aura ?? -1; }
  set aura(aura: number) {
    const host = this.appearanceHost;
    if (!host) return;
    host.mutateAppearance(() => { host.aura = aura; });
  }

  private syncViewPlacement() {
    this.appearanceHost?.syncAppearanceToCurrentViewPlacement();
  }
  get floorRing(): string { return (this.appearanceHost as any)?.floorRing || 'none'; }
  get floorRingUrl(): string { return this.characterFxMenu.ringAsset(this.floorRing); }
  get floorRingSpeed(): number { return (this.appearanceHost as any)?.floorRingSpeed || 1; }
  get floorRingColor(): string { return (this.appearanceHost as any)?.floorRingColor || ''; }

  /**
   * Ephemeral underfoot turn mark from CombatTracker (not synced floorRing FX).
   * Matches body id — all Tokens of that sheet share the mark.
   */
  get combatTurnMark(): 'current' | 'next' | null {
    const bodyId = this.gameCharacter?.identifier;
    if (!bodyId) return null;
    const tracker = CombatTracker.instance;
    const e = tracker.activeEncounter;
    if (!e?.isStarted) return null;
    const isGM = !!PeerCursor.myCursor?.isGMMode;
    const cur = tracker.currentCombatant();
    if (cur?.characterIdentifier === bodyId) {
      if (cur.isHidden && !isGM) return null;
      return 'current';
    }
    const next = tracker.nextCombatant();
    if (next?.characterIdentifier === bodyId) {
      if (next.isHidden && !isGM) return null;
      return 'next';
    }
    return null;
  }

  get tokenFrame(): string { return (this.appearanceHost as any)?.tokenFrame || 'none'; }
  get hasTokenFrame(): boolean { return this.is2DMode && this.tokenFrame !== 'none'; }
  get isShowName(): boolean { return (this.appearanceHost as any)?.isShowName !== false; }
  get tokenFrameCaption(): string { return (this.appearanceHost as any)?.tokenFrameCaption || this.name || ''; }
  /** Polaroid film strip: name lives in the white margin (not the floating tag). */
  get showPolaroidCaption(): boolean {
    return this.hasTokenFrame && this.tokenFrame === 'polaroid' && this.isShowName && 0 < this.tokenFrameCaption.length;
  }
  get showFloatingName(): boolean {
    return this.isShowName && 0 < this.name.length && !this.showPolaroidCaption;
  }
  /** Token footprint size in px (2D cell / 3D image). */
  get tokenBoxWidthPx(): number {
    return this.is2DMode ? this.size * this.gridSize : this.characterImageWidth;
  }
  get tokenBoxHeightPx(): number {
    return this.is2DMode ? this.size * this.gridSize : this.characterImageHeight;
  }
  get pushPin(): boolean { return !!(this.appearanceHost as any)?.pushPin && this.is2DMode; }
  get pushPinAngle(): number { return (this.appearanceHost as any)?.pushPinAngle || 0; }
  get pushPinLeft(): number {
    const v = (this.appearanceHost as any)?.pushPinLeft;
    return typeof v === 'number' ? v : -4;
  }
  get pushPinTop(): number {
    const v = (this.appearanceHost as any)?.pushPinTop;
    return typeof v === 'number' ? v : -20;
  }
  get pushPinColor(): string { return (this.appearanceHost as any)?.pushPinColor || 'red'; }
  get pushPinSrc(): string {
    const host = this.appearanceHost;
    return pushPinAssetUrl(
      this.pushPinColor,
      this.pushPinAngle,
      (host as any)?.pushPinStyle,
      host?.identifier,
    );
  }
  get statusEntries() {
    return this.gameCharacter ? this.characterFxMenu.statusesOf(this.gameCharacter) : [];
  }
  /**
   * Prefer one line for normal names (no max-width).
   * Only very long names get a cap so they wrap.
   */
  get nameTagMaxWidth(): number | null {
    if (!nameTagShouldWrap(this.name || '')) return null;
    return NAME_TAG_WRAP_WIDTH_PX;
  }
  get nameTagWrap(): boolean {
    return nameTagShouldWrap(this.name || '');
  }
  get hasInvisibleStatus(): boolean { return this.statusEntries.some(s => s.id === 'invisible'); }
  get hasDeadStatus(): boolean { return this.statusEntries.some(s => s.id === 'dead'); }
  statusIcon(id: string): string { return getStatusDef(id as any)?.icon || 'info'; }
  statusName(id: string): string {
    const name = this.i18n.t(`fx.status.${id}`);
    const entry = this.statusEntries.find(s => s.id === id);
    return entry?.level ? `${name} ${entry.level}` : name;
  }

  /** Right-click a head status badge to clear it without opening the token menu. */
  onStatusBadgeContextMenu(e: Event, id: CharacterStatusId) {
    e.stopPropagation();
    e.preventDefault();
    if (this.GuestMode()) return;
    this.characterFxMenu.clearStatus(this.gameCharacter, id);
    this.changeDetector.markForCheck();
  }

  get isNotRide(): boolean { return !!this.appearanceHost?.isNotRide; }
  set isNotRide(isNotRide: boolean) {
    if (this.appearanceHost) this.appearanceHost.isNotRide = isNotRide;
  }
  get isUseIconToOverviewImage(): boolean { return !!this.appearanceHost?.isUseIconToOverviewImage; }
  set isUseIconToOverviewImage(isUseIconToOverviewImage: boolean) {
    const host = this.appearanceHost;
    if (!host) return;
    host.mutateAppearance(() => {
      host.isUseIconToOverviewImage = isUseIconToOverviewImage;
    });
  }

  hasOverviewFaceIcon(): boolean {
    return !!(this.faceIcon && 0 < this.faceIcon.url?.length);
  }

  get ownerName(): string {
    return (this.appearanceHost as any)?.ownerName || this.gameCharacter?.ownerName || '';
  }
  get ownerColor(): string {
    return (this.appearanceHost as any)?.ownerColor ?? this.gameCharacter?.ownerColor;
  }
  get isHideIn(): boolean {
    if (this.characterToken) return this.characterToken.isHideIn;
    return !!this.gameCharacter?.owner;
  }
  get isVisible(): boolean {
    if (this.characterToken) return this.characterToken.isVisible;
    return this.gameCharacter?.isVisible;
  }
  get isGMMode(): boolean{ return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false; }
  /** Other players cannot drag a token claimed as someone's PC. */
  get isMoveLocked(): boolean {
    if (this.characterToken) return this.characterToken.isLockedByPlayerOwner;
    return !!this.gameCharacter?.isLockedByPlayerOwner;
  }

  get faceIcon(): ImageFile { return this.gameCharacter?.faceIcon; }
  
  get dialogFaceIcon(): ImageFile {
    if (!this.dialog || !this.dialog.faceIconIdentifier) return null;
    return ImageStorage.instance.get(<string>this.dialog.faceIconIdentifier);
  }

  get shadowImageFile(): ImageFile { return this.gameCharacter?.shadowImageFile ?? ImageFile.Empty; }

  get elevation(): number {
    return +((this.tablePiece.posZ + (this.altitude * this.gridSize)) / this.gridSize).toFixed(1);
  }

  /** Selection keys the on-table piece (Token), not the off-table sheet body. */
  get selectionState(): SelectionState { return this.selectionService.state(this.tablePiece); }
  get isSelected(): boolean { return this.selectionState !== SelectionState.NONE; }
  get isMagnetic(): boolean { return this.selectionState === SelectionState.MAGNETIC; }

  gridSize: number = 50;
  math = Math;
  stringUtil = StringUtil;
  viewRotateX = 50;
  viewRotateZ = 10;
  heightWidthRatio = 1.5;

  set dialog(dialog) {
    if (!dialog || !dialog.text) return;
    // Guests may view speech balloons; only block when this peer cannot see the token.
    if (!this.gameCharacter) return;
    if (!this.gameCharacter.isVisible && !this.isGMMode) return;
    clearTimeout(this.dialogTimeOutId);
    clearInterval(this.chatIntervalId);
    let text = StringUtil.cr(dialog.text);
    const isEmote = StringUtil.isEmote(text);
    const rubys = [];
    const re = /[\|｜]([^\|｜\s]+?)《(.+?)》/g;
    let ary;
    let count = 0;
    let rubyLength = 0;

    if (!isEmote) {
      text = text.replace(/[。、]{3}/g, '…').replace(/[。、]{2}/g, '‥').replace(/(。|[\r\n]{2,})/g, "$1                            ").trimEnd(); // 在換行或句號後留時間的 dirty hack
      while ((ary = re.exec(text)) !== null) {
        let offset = ary.index - (count * 3);
        rubys.push({base: ary[1], ruby: ary[2], start: offset - rubyLength, end: offset + ary[1].length - rubyLength - 1});
        count++;
        rubyLength += ary[2].length;
      }
    }

    let speechDelay = 1000 / Array.from(text).length > 36 ? 1000 / Array.from(text).length : 36;
    if (speechDelay > 200) speechDelay = 200;
    this.dialogTimeOutId = setTimeout(() => {
      const stamp = dialog.stamp || this.lastChatDialogStamp;
      this.clearChatDialogLocal();
      if (stamp && this.gameCharacter.chatDialogStamp === stamp) {
        this.gameCharacter.clearChatDialog();
      }
      this.changeDetector.markForCheck();
    }, Array.from(text).length * speechDelay + 6000);

    this.gameCharacter.dialog = dialog;
    this.gameCharacter.isEmote = isEmote;
    count = 0;
    let countLength = 0;
    let rubyCount = 0;
    let tmpText = '';
    let carrentRuby = rubys.shift();
    let rubyText = '';
    let isOpenRuby = false;
    if (isEmote) {
      this.gameCharacter.text = text;
      this.changeDetector.markForCheck();
    }  else {
      const charAry = Array.from(text.replace(/[\|｜]([^\|｜\s]+?)《.+?》/g, '$1'));
      this.chatIntervalId = setInterval(() => {
        let c = charAry[count];
        let isMulti = c.length > 1;
        if (c) {
            if (!isOpenRuby && carrentRuby && countLength >= carrentRuby.start) {
                tmpText += '<ruby>';
                isOpenRuby = true;
                rubyCount = 0;
            }
            tmpText += StringUtil.escapeHtml(c);
            if (isOpenRuby) {
                rubyCount += 1;
                let rt = carrentRuby.ruby;
                rubyText = '<rt>' + StringUtil.escapeHtml(Array.from(rt).slice(0, Math.ceil(Array.from(rt).length * (rubyCount / Array.from(carrentRuby.base).length))).join('')) + '</rt>'
            }
            if (isOpenRuby && carrentRuby && countLength >= carrentRuby.end - (isMulti ? 1 : 0)) {
                tmpText += (rubyText + '</ruby>');
                isOpenRuby = false;
                carrentRuby = rubys.shift(); 
            }
            countLength += c.length;
        }
        count += 1;
        this.gameCharacter.text = tmpText + (isOpenRuby ? (rubyText + '</ruby>') : '');
        this.changeDetector.markForCheck();
        if (count >= charAry.length) {
          clearInterval(this.chatIntervalId);
        }
      }, speechDelay);
    }
  }

  get dialogText(): string {
    if (!this.gameCharacter || !this.gameCharacter.text) return '';
    const ary = this.gameCharacter.text.replace(/。/g, "。\n\n").split(/[\r\n]{2,}/g).filter(str => str.trim());
    return ary.length > 0 ? ary.reverse()[0].trim() : '';
  }
  
  get isRubied(): boolean {
    if (!this.gameCharacter || !this.gameCharacter.text) return false;
    return -1 < this.dialogText.indexOf('<ruby>');
  }

  get dialogChatBubbleMinWidth(): number {
    const max = this.characterImageWidth + 2.1 * this.gridSize;
    const existIcon = this.isUseFaceIcon && this.dialogFaceIcon && this.dialogFaceIcon.url;
    const dynamic = Array.from(this.dialogText).length * 11 + 52 + (existIcon ? 32 : 0);
    return max < dynamic ? max : dynamic; 
  }

  get dialog() {
    return this.gameCharacter.dialog;
  }

  selected = false;
  private dialogTimeOutId = null;
  private chatIntervalId = null;
  private lastChatDialogStamp = 0;

  get chatBubbleXDeg(): number {
    //console.log(this.viewRotateX)
    let ret = 90 - this.viewRotateX;
    if (ret < 0) ret = 360 + ret;
    ret = ret % 360;
    if (ret > 180) ret = -(180 - (ret - 180));
    //console.log(ret)
    // 補正
    if (ret > 90) ret = 90;
    if (ret < -90) ret = -90;
    return ret / 1.5;
  }

  @ViewChild('characterImage') characterImage: ElementRef;
  //@ViewChild('characterShadowImage') characterShadowImage: ElementRef;
  @ViewChild('chatBubble') chatBubble: ElementRef;

  //height = 0;
  naturalImageWidth = 0;
  naturalImageHeight = 0
  naturaHeightWidthRatio = 1;

  get characterImageHeight(): number {
    if (!this.characterImage || !this.naturalImageHeight) return 0;
    if (this.height > 0) return this.gridSize * this.height;
    let ratio = this.naturaHeightWidthRatio;
    if (ratio > this.heightWidthRatio) ratio = this.heightWidthRatio;
    return ratio * this.gridSize * this.size;
  }

  get characterImageWidth(): number {
    if (!this.characterImage || !this.naturalImageWidth) return 0;
    if (this.height <= 0) return this.gridSize * this.size;
    let ratio = this.naturaHeightWidthRatio;
    if (ratio > this.heightWidthRatio) ratio = this.heightWidthRatio;
    return this.gridSize * this.height / ratio;
  }

  /** Ground-shadow shrink/fade factor from altitude (1 on ground, smaller when flying). */
  get shadowAltitudeFactor(): number {
    return Math.max(0.35, 1 / (1 + Math.max(0, this.altitude) * 0.45));
  }

  get characterShadowImageHeight(): number {
    // Follow token image height (size / height), then shrink with altitude.
    return this.characterImageHeight * this.shadowAltitudeFactor;
  }

  get characterShadowImageWidth(): number {
    // Follow token image width (size / height), then shrink with altitude.
    return this.characterImageWidth * this.shadowAltitudeFactor;
  }

  get characterShadowOffset(): number {
    // With Fly: pin near pedestal with *0.99 so the flattened silhouette falls
    // behind the upright art — not centered on the token base.
    let offset = 0;
    if (0.2 < this.height && this.height <= 0.3) {
      offset = 0.09;
    } else if (0.1 < this.height && this.height <= 0.2) {
      offset = 0.19;
    } else if (0 < this.height && this.height <= 0.1) {
      offset = 0.29;
    }
    return (this.gridSize * this.size / 2) - (this.characterShadowImageHeight * 0.99) - (this.gridSize * offset);
  }

  get shadowOpacity(): number {
    const base = (this.isHollow ? 0.5 : 0.7) * (this.isHideIn ? 0.85 : 1);
    return base * Math.max(0.3, 1 / (1 + Math.max(0, this.altitude) * 0.35));
  }

  get shadowBlurPx(): number {
    return 1 + Math.max(0, this.altitude) * 0.6;
  }

  get shadowTranslateX(): number {
    return (this.gridSize * this.size - this.characterShadowImageWidth) / 2;
  }

  get chatBubbleAltitude(): number {
    let cos =  Math.cos(this.roll * Math.PI / 180);
    let sin = Math.abs(Math.sin(this.roll * Math.PI / 180));
    if (cos < 0.5) cos = 0.5;
    if (sin < 0.5) sin = 0.5;
    const altitude1 = (this.characterImageHeight + (this.name != '' ? 24 : 0)) * cos + 4;
    const altitude2 = (this.characterImageWidth / 2) * sin + 4 + this.characterImageWidth / 2;
    let ret = altitude1 > altitude2 ? altitude1 : altitude2;
    this.gameCharacter.chatBubbleAltitude = ret;
    return ret;
  }

  get elevationUnrerZeroIndicatorY(): number {
    let ret = Math.max(this.characterImageWidth, this.chatBubbleAltitude) + 4;
    if (Math.abs(this.altitude * this.gridSize) < ret) {
      return -this.altitude * this.gridSize - 4;
    }
    return ret;
  }

  /*
  // 自原始高度扣除的值
  get nameplateOffset(): number {
    return 0;
    if (!this.characterImage) return this.gridSize * this.size * this.heightWidthRatio;
    return this.gridSize * this.size * this.heightWidthRatio - this.characterImageHeight;
  }
  */
  get nameTagRotate(): number {
    // Top-down 2D: keep the tag flat on the table (billboard math makes text edge-on).
    if (this.is2DMode) return 0;
    let x = (this.viewRotateX % 360) - 90;
    let z = (this.viewRotateZ + this.rotate) % 360;
    let roll = this.roll % 360;
    z = (z > 0 ? z : 360 + z);
    roll = (roll > 0 ? roll : 360 + roll);
    return (x > 0 ? x : 360 + x) * (90 < z && z < 270 ? 1 : -1) * (90 <= roll && roll <= 270 ? -1 : 1);
  }

  get isListen(): boolean {
    return (this.dialog && this.dialog.text && !this.dialog.dialogTest && this.dialog.text.trim().length > 0);
  }

  get isWhisper(): boolean {
    return this.dialog && this.dialog.secret;
  }

  get isEmote(): boolean {
    return !!this.gameCharacter?.isEmote;
    //return this.dialog && StringUtil.isEmote(this.dialog.text);
  }

  get isUseFaceIcon(): ImageFile {
    return this.dialog && this.dialog.faceIconIdentifier;
  }

  get dialogColor(): string {
    return (this.dialog && this.dialog.color) ? this.dialog.color : PeerCursor.CHAT_DEFAULT_COLOR;
  }

  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};
  rollOption: RotableOption = {};

  constructor(
    private contextMenuService: ContextMenuService,
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private pointerDeviceService: PointerDeviceService,
    private ngZone: NgZone,
    private modalService: ModalService,
    private selectionService: TabletopSelectionService,
    private characterFxMenu: CharacterFxMenuService,
    private tabletopActionService: TabletopActionService,
    private i18n: I18nService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }

  private applySyncedChatDialog() {
    if (!this.gameCharacter) return;
    const stamp = this.gameCharacter.chatDialogStamp || 0;
    if (!stamp) {
      if (this.lastChatDialogStamp) this.clearChatDialogLocal();
      return;
    }
    if (stamp === this.lastChatDialogStamp) return;
    this.applyChatDialogPayload({
      characterIdentifier: this.gameCharacter.identifier,
      text: this.gameCharacter.chatDialogText,
      color: this.gameCharacter.chatDialogColor,
      faceIconIdentifier: this.gameCharacter.chatDialogFaceIconIdentifier || null,
      secret: false,
      stamp,
      isEmote: this.gameCharacter.chatDialogIsEmote,
    });
  }

  private applyChatDialogPayload(data: any) {
    if (!data || !data.text) return;
    const stamp = data.stamp || 0;
    if (stamp && stamp === this.lastChatDialogStamp) return;
    if (stamp) this.lastChatDialogStamp = stamp;
    this.dialog = data;
  }

  private clearChatDialogLocal() {
    this.lastChatDialogStamp = 0;
    if (this.gameCharacter) {
      this.gameCharacter.dialog = null;
      this.gameCharacter.text = '';
      this.gameCharacter.isEmote = false;
    }
    clearTimeout(this.dialogTimeOutId);
    clearInterval(this.chatIntervalId);
  }

  
  /*
  ngOnInit() {
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        let object = ObjectStore.instance.get(event.data.identifier);
        if (!this.gameCharacter || !object) return;
        if (this.gameCharacter === object || (object instanceof ObjectNode && this.gameCharacter.contains(object))) {
          if (this.gameCharacter.imageFiles.length <= 0) {
            this.naturalImageHeight = 0;
            this.naturalImageWidth = 0;
            this.naturaHeightWidthRatio = 1;
          }
          this.changeDetector.markForCheck();
        }
    private selectionService: TabletopSelectionService,
    private pointerDeviceService: PointerDeviceService
  ) { }
*/
  ngOnChanges(): void {
    if (this.characterToken) {
      const body = this.characterToken.character;
      if (body) this.gameCharacter = body;
    }
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.gameCharacter?.identifier}`, event => {
        if (this.gameCharacter.imageFiles.length <= 0) {
          this.naturalImageHeight = 0;
          this.naturalImageWidth = 0;
          this.naturaHeightWidthRatio = 1;
        }
        this.applySyncedChatDialog();
        this.refreshSlopeAlign();
        this.changeDetector.markForCheck();
      });
    if (this.characterToken) {
      EventSystem.register(this)
        .on(`UPDATE_GAME_OBJECT/identifier/${this.characterToken.identifier}`, () => {
          this.refreshSlopeAlign();
          this.changeDetector.markForCheck();
        })
        .on(`UPDATE_SELECTION/identifier/${this.characterToken.identifier}`, () => {
          this.changeDetector.markForCheck();
        });
    }
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${CombatTracker.instance.identifier}`, () => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        const table = TableSelecter.instance?.viewTable;
        const id = event.data?.identifier;
        if (!table || !id) return;
        if (id === table.identifier) {
          this.enforce2DRollZero();
          this.refreshSlopeAlign();
          this.changeDetector.markForCheck();
          return;
        }
        // Terrain pose/slope changed: refresh tip only if this token may be affected
        // (avoids N characters × M terrain edits thrashing CD / looking like room lag).
        if (event.data?.aliasName === 'terrain') {
          const terrain = ObjectStore.instance.get<Terrain>(id);
          if (!(terrain instanceof Terrain)) return;
          const piece = this.tablePiece ?? this.appearanceHost;
          if (!piece || piece.location?.name !== 'table') return;
          const size = this.size || 1;
          const g = this.gridSize;
          const cx = piece.location.x + (size * g) / 2;
          const cy = piece.location.y + (size * g) / 2;
          if (!this._slopeAlignCss && !terrain.mayAffectWorldPoint(cx, cy, g)) return;
          this.refreshSlopeAlign();
          this.changeDetector.markForCheck();
        }
      })
      .on('AFTER_VIEW_TABLE_CHANGE', () => {
        // Dual-map hosts may not remount; force CD so 2D↔3D upright / frame update.
        this.enforce2DRollZero();
        this.refreshSlopeAlign();
        const maps = this.gameCharacter?.placementTableIds || [];
        if (maps.length > 1) {
          folderBackupDebug('char AFTER_VIEW_TABLE_CHANGE dual', {
            name: this.gameCharacter?.name || '',
            id: (this.gameCharacter?.identifier || '').slice(0, 10),
            is2D: this.is2DMode,
            upright: (this.uprightTransform || '').slice(0, 48),
            maps: maps.map(m => m.slice(0, 14)),
          });
        }
        this.changeDetector.markForCheck();
        // Already in a click/CD turn: upcoming tick picks up markForCheck.
        // Outside Angular (rare EventSystem path): one shared zone kick for all chars.
        if (!NgZone.isInAngularZone()) {
          if (GameCharacterComponent.viewTableKickScheduled) return;
          GameCharacterComponent.viewTableKickScheduled = true;
          this.ngZone.run(() => { GameCharacterComponent.viewTableKickScheduled = false; });
        }
      })
      .on(`UPDATE_OBJECT_CHILDREN/identifier/${this.gameCharacter?.identifier}`, event => {
        if (this.gameCharacter.imageFiles.length <= 0) {
          this.naturalImageHeight = 0;
          this.naturalImageWidth = 0;
          this.naturaHeightWidthRatio = 1;
        }
        this.changeDetector.markForCheck();
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', event => {
        this.changeDetector.markForCheck();
      })
      .on<object>('TABLE_VIEW_ROTATE', -1000, event => {
        this.ngZone.run(() => {
          this.viewRotateX = event.data['x'];
          this.viewRotateZ = event.data['z'];
          this.changeDetector.markForCheck();
        });
      })
      .on<object>('SELECT_TABLETOP_OBJECT', -1000, event => {
        // 暫且如此
        this.ngZone.run(() => {
          const id = event.data?.['identifier'];
          const pieceId = this.tablePiece?.identifier;
          const bodyId = this.gameCharacter?.identifier;
          if (event.data['highlighting'] && id && (id === pieceId || id === bodyId)) {
            this.selected = true;
          } else {
            this.selected = false;
          }
          this.changeDetector.markForCheck();
        });
      })
      .on('CHANGE_GM_MODE', event => {
        this.changeDetector.markForCheck();
      })
      .on('POPUP_CHAT_BALLOON', -1000, event => {
        if (this.gameCharacter && this.gameCharacter.identifier == event.data.characterIdentifier) {
          // Same body can have multiple Tokens; only the major on this view shows the balloon.
          if (this.characterToken && !this.characterToken.isMajorMarker) return;
          this.ngZone.run(() => {
            this.applyChatDialogPayload(event.data);
            this.changeDetector.markForCheck();
          });
        }
      })
      .on('FAREWELL_CHAT_BALLOON', -1000, event => {
        if (this.gameCharacter && this.gameCharacter.identifier == event.data.characterIdentifier) {
          if (this.characterToken && !this.characterToken.isMajorMarker) return;
          this.ngZone.run(() => {
            this.clearChatDialogLocal();
            this.changeDetector.markForCheck();
          });
        }
      })
      .on(`UPDATE_SELECTION/identifier/${this.gameCharacter?.identifier}`, event => {
        this.changeDetector.markForCheck();
      });
    this.applySyncedChatDialog();
    this.enforce2DRollZero();
    this.movableOption = {
      tabletopObject: this.tablePiece,
      transformCssOffset: layerPeerMovableTransform(),
      colideLayers: ['terrain', 'text-note', 'character', 'character-token']
    };
    this.rotableOption = {
      tabletopObject: this.tablePiece
    };
    this.rollOption = {
      tabletopObject: this.tablePiece,
      targetPropertyName: 'roll',
    };
    // Room ZIP reuses syncIds; recycled views skip ngAfterViewInit — mark loaded here too.
    this.markCharacterLoaded();
  }

  ngAfterViewInit() {
    this.logMount('ngAfterViewInit');
    this.markCharacterLoaded();
  }

  private markCharacterLoaded() {
    // Defer: parent binds [style.visibility] to isLoaded; sync flip in the same CD
    // pass causes NG0100. visibility:hidden still allows bounceInOut to finish.
    queueMicrotask(() => {
      if (this.characterToken) {
        if (this.characterToken.isLoaded) return;
        this.characterToken.isLoaded = true;
        this.logMount('markLoaded');
        this.changeDetector.markForCheck();
        return;
      }
      if (!this.gameCharacter || this.gameCharacter.isLoaded) return;
      this.gameCharacter.isLoaded = true;
      this.logMount('markLoaded');
      this.changeDetector.markForCheck();
    });
  }

  private logMount(phase: string) {
    if (GameCharacterComponent.mountLogBudget <= 0) return;
    GameCharacterComponent.mountLogBudget--;
    const c = this.gameCharacter;
    if (!c) return;
    const maps = c.placementTableIds || [];
    const viewId = TableSelecter.instance?.viewedTableIdentifier
      || TableSelecter.instance?.viewTableIdentifier
      || '';
    const pose = viewId ? c.getPoseForTable(viewId) : null;
    folderBackupDebug(`char ${phase}`, {
      name: c.name || '',
      id: c.identifier.slice(0, 10),
      dual: maps.length > 1,
      maps: maps.map(m => m.slice(0, 14)),
      skipBounce: this.skipEnterBounce,
      is2D: this.is2DMode,
      isLoaded: !!c.isLoaded,
      isVisibleOnTable: !!c.isVisibleOnTable,
      live: `${c.location?.x | 0},${c.location?.y | 0},${c.posZ | 0}`,
      pose: pose ? `${pose.x | 0},${pose.y | 0},${pose.posZ | 0}` : '-',
      upright: (this.uprightTransform || '').slice(0, 48),
      img: !!(c.imageFile?.url?.length),
      budgetLeft: GameCharacterComponent.mountLogBudget,
    });
  }

  /** Destroy logs must not eat mount budget (Angular destroys before creates on remount). */
  private logUnmount() {
    const c = this.gameCharacter;
    if (!c) return;
    const maps = c.placementTableIds || [];
    // Always log dual-map; rate-limit the rest.
    if (maps.length <= 1) {
      if (GameCharacterComponent.mountLogBudget <= 0) return;
      GameCharacterComponent.mountLogBudget--;
    }
    folderBackupDebug('char ngOnDestroy', {
      name: c.name || '',
      id: c.identifier.slice(0, 10),
      dual: maps.length > 1,
      maps: maps.map(m => m.slice(0, 14)),
      isLoaded: !!c.isLoaded,
      live: `${c.location?.x | 0},${c.location?.y | 0},${c.posZ | 0}`,
      budgetLeft: GameCharacterComponent.mountLogBudget,
    });
  }

  ngOnDestroy() {
    this.logUnmount();
    this.clearChatDialogLocal();
    EventSystem.unregister(this);
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e: any) {
    console.log('Dragstart Cancel !!!!');
    e.stopPropagation();
    e.preventDefault();
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (this.GuestMode()) return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;

    this.tabletopActionService.ensureObjectSelected(this.tablePiece);

    let position = this.pointerDeviceService.pointers[0];
    let menuActions: ContextMenuAction[] = [];
    let title = this.name;

    if (this.isMultiSelectedCharacters()) {
      menuActions = this.makeMultiSelectionContextMenu();
      title = this.i18n.t('char.selectedCount', { count: this.selectedTablePieces().length });
    } else {
      menuActions = menuActions.concat(this.makeSelectionContextMenu());
      menuActions = menuActions.concat(this.makeContextMenu());
    }
    menuActions = this.tabletopActionService.withClipboardMenuPrefix(menuActions);
    this.contextMenuService.open(position, menuActions, title);
  }

  onInteractStart() {
    // Same as card/note: pointer down brings token to shared [ ] front.
    if (!this.GuestMode() && !this.isMoveLocked) {
      const piece = this.characterToken || this.gameCharacter;
      piece?.raiseInTier();
    }
  }

  onMove() {
    this.contextMenuService.close();
    if (!this.isHideIn) SoundEffect.play(PresetSound.piecePick);
  }

  onMoved() {
    // 暫且：移動後清除 💭
    if (this.gameCharacter && this.gameCharacter.text) {
      EventSystem.call('FAREWELL_CHAT_BALLOON', { characterIdentifier: this.gameCharacter.identifier });
    }
    if (!this.isHideIn) SoundEffect.play(PresetSound.piecePut);
    this.selected = false;
    this.refreshSlopeAlign();
  }

  onImageLoad() {
    this.naturalImageWidth = this.characterImage.nativeElement.naturalWidth;
    this.naturalImageHeight = this.characterImage.nativeElement.naturalHeight;
    this.naturaHeightWidthRatio =  (this.naturalImageWidth && this.naturalImageHeight) ? (this.naturalImageHeight / this.naturalImageWidth) : 1;
    //EventSystem.trigger('UPDATE_GAME_OBJECT', this.gameCharacter);
  }

  /** Selected map pieces: Tokens when this view is a token, else GameCharacters. */
  private selectedTablePieces(): Array<GameCharacter | CharacterToken> {
    if (this.characterToken) {
      return this.selectionService.objects.filter(
        (o): o is CharacterToken => o instanceof CharacterToken
      );
    }
    return this.selectionService.objects.filter(
      (o): o is GameCharacter => o instanceof GameCharacter
    );
  }

  /** Unique bodies from current selection (Token → sheet). */
  private selectedBodiesFromSelection(): GameCharacter[] {
    const byId = new Map<string, GameCharacter>();
    for (const o of this.selectionService.objects) {
      if (o instanceof CharacterToken) {
        const body = o.character;
        if (body) byId.set(body.identifier, body);
      } else if (o instanceof GameCharacter) {
        byId.set(o.identifier, o);
      }
    }
    return Array.from(byId.values());
  }

  /** @deprecated Use {@link selectedTablePieces} / {@link selectedBodiesFromSelection}. */
  private selectedCharacters(): GameCharacter[] {
    return this.selectedBodiesFromSelection();
  }

  /** Selected map pieces for altitude / cosmetics batch actions. */
  private selectedAppearanceHosts(): Array<GameCharacter | CharacterToken> {
    return this.selectedTablePieces();
  }

  private isMultiSelectedCharacters(): boolean {
    return this.isSelected && this.selectedTablePieces().length > 1;
  }

  private removeTokenFromTable(token: CharacterToken) {
    this.selectionService.remove(token);
    CharacterToken.destroyToken(token);
  }

  private moveCharacterOffTable(gameCharacter: GameCharacter, location: string) {
    EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameCharacter.identifier });
    this.selectionService.remove(gameCharacter);
    if (location === 'graveyard' && gameCharacter.isTemporaryCopy) {
      CharacterToken.destroyTokensForCharacter(gameCharacter.identifier);
      gameCharacter.destroy();
      return;
    }
    if (location === 'table') {
      gameCharacter.setLocation('table');
    } else {
      CharacterToken.removeTokensOnTable(gameCharacter.identifier);
      // Per-map: keep placements on other maps for legacy; body stays in inventory.
      if (gameCharacter.location.name === 'table') {
        gameCharacter.leaveCurrentTable(location);
      } else {
        gameCharacter.setLocation(location);
      }
    }
  }

  /** Congregate only — used when not in multi-character mode (e.g. gather selection to an unselected token). */
  private makeSelectionContextMenu(): ContextMenuAction[] {
    if (this.selectionService.size <= 1) return [];

    let objectPosition = {
      x: this.tablePiece.location.x + (this.size * this.gridSize) / 2,
      y: this.tablePiece.location.y + (this.size * this.gridSize) / 2,
      z: this.tablePiece.posZ
    };
    return [
      { name: this.i18n.t('char.congregate'), hotkey: 'T', action: () => this.selectionService.congregate(objectPosition) },
      ContextMenuSeparator,
    ];
  }

  /** Right-click menu when 2+ selected characters include this token. */
  private makeMultiSelectionContextMenu(): ContextMenuAction[] {
    const pieces = () => this.selectedTablePieces();
    const bodies = () => this.selectedBodiesFromSelection();
    let objectPosition = {
      x: this.tablePiece.location.x + (this.size * this.gridSize) / 2,
      y: this.tablePiece.location.y + (this.size * this.gridSize) / 2,
      z: this.tablePiece.posZ
    };

    const removePiece = (piece: GameCharacter | CharacterToken, location: string) => {
      if (piece instanceof CharacterToken) {
        this.removeTokenFromTable(piece);
        return;
      }
      this.moveCharacterOffTable(piece, location);
    };

    return [
      { name: this.i18n.t('char.congregate'), hotkey: 'T', action: () => this.selectionService.congregate(objectPosition) },
      ContextMenuSeparator,
      this.characterFxMenu.makeCombatMenu(this.gameCharacter),
      ContextMenuSeparator,
      {
        name: this.i18n.t('char.moveTo'),
        action: null,
        subActions: [
          {
            name: this.i18n.t('char.moveAllToCommon'),
            action: () => {
              pieces().forEach(p => removePiece(p, 'common'));
              SoundEffect.play(PresetSound.piecePut);
            }
          },
          {
            name: this.i18n.t('char.moveAllToPersonal'),
            action: () => {
              pieces().forEach(p => removePiece(p, Network.peerId));
              SoundEffect.play(PresetSound.piecePut);
            }
          },
          {
            name: this.i18n.t('char.moveAllToGraveyard'),
            action: () => {
              pieces().forEach(p => removePiece(p, 'graveyard'));
              SoundEffect.play(PresetSound.sweep);
            }
          },
        ]
      },
      {
        name: this.i18n.t('char.inventoryAllOn'),
        action: () => {
          bodies().forEach(ch => { ch.isInventoryIndicate = true; });
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      },
      {
        name: this.i18n.t('char.inventoryAllOff'),
        action: () => {
          bodies().forEach(ch => { ch.isInventoryIndicate = false; });
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      },
      ...(this.is2DMode ? [] : [{
        name: this.i18n.t('char.resetAltitudeAll'),
        action: () => {
          this.selectedAppearanceHosts().forEach(ch => { ch.altitude = 0; });
          SoundEffect.play(PresetSound.sweep);
        }
      }]),
      ContextMenuSeparator,
      {
        name: this.i18n.t('char.deleteAllToGraveyard'),
        hotkey: 'Del',
        action: () => {
          pieces().forEach(p => removePiece(p, 'graveyard'));
          SoundEffect.play(PresetSound.sweep);
        }
      },
      ContextMenuSeparator,
      {
        name: this.i18n.t('char.clearSelection'),
        action: () => this.selectionService.clear()
      },
    ];
  }

  private makeContextMenu(): ContextMenuAction[] {
    const after = () => EventSystem.trigger('UPDATE_INVENTORY', null);
    const imageCount = this.gameCharacter.imageFiles.length;
    const hasMultiImage = imageCount > 1;
    const hasFace = this.hasOverviewFaceIcon();
    if (!hasFace && this.isUseIconToOverviewImage) this.isUseIconToOverviewImage = false;

    const clonePose = () => {
      const pose = (this.characterToken || this.gameCharacter).getPoseForView();
      return {
        x: pose.x + this.gridSize,
        y: pose.y + this.gridSize,
        posZ: pose.posZ,
      };
    };

    const advancedCopy: ContextMenuAction = {
      name: this.i18n.t('char.copyAdvanced'),
      action: null,
      subActions: [
        {
          name: this.i18n.t('char.createTemporaryCopy'),
          action: () => {
            const body = this.characterToken?.character || this.gameCharacter;
            if (!body) return;
            const pose = clonePose();
            GameCharacter.createTemporaryCopy(body, pose, undefined, this.characterToken || body);
            SoundEffect.play(PresetSound.piecePut);
          }
        },
        {
          name: this.i18n.t('char.cloneToken'),
          action: () => {
            const body = this.characterToken?.character || this.gameCharacter;
            if (!body) return;
            const pose = clonePose();
            const names = ObjectStore.instance.getObjects(CharacterToken)
              .filter(t => t.characterId === body.identifier)
              .map(t => t.displayNameOverride || body.name);
            names.push(body.name);
            const token = CharacterToken.create(body.identifier, pose, {
              copyAppearanceFrom: this.characterToken || body,
              major: false,
            });
            if (GameCharacter.menuCloneAutoNumber) {
              token.displayNameOverride = GameCharacter.nextNumberedName(body.name, names);
              token.update();
            }
            SoundEffect.play(PresetSound.piecePut);
          }
        },
        {
          name: this.i18n.t('char.cloneCharacter'),
          action: () => {
            const body = this.characterToken?.character || this.gameCharacter;
            if (!body) return;
            const pose = clonePose();
            GameCharacter.cloneCharacter(body, {
              numbered: GameCharacter.menuCloneAutoNumber,
              pose,
              copyAppearanceFrom: this.characterToken || body,
            });
            SoundEffect.play(PresetSound.piecePut);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        },
        contextMenuToggleCheck({
          get: () => GameCharacter.menuCloneAutoNumber,
          set: (v) => { GameCharacter.menuCloneAutoNumber = v; },
          on: this.i18n.t('char.cloneAutoNumberOn'),
          off: this.i18n.t('char.cloneAutoNumberOff'),
        }),
      ],
    };

    const deleteAction: ContextMenuAction = {
      name: this.characterToken?.isTemporaryCopy || this.gameCharacter.isTemporaryCopy
        ? this.i18n.t('char.deleteTemporaryCopy')
        : this.i18n.t('char.deleteToGraveyard'),
      hotkey: 'Del',
      action: () => {
        if (this.characterToken) {
          this.selectionService.remove(this.characterToken);
          CharacterToken.destroyToken(this.characterToken);
          SoundEffect.play(PresetSound.sweep);
          return;
        }
        EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
        this.selectionService.remove(this.gameCharacter);
        CharacterToken.destroyTokensForCharacter(this.gameCharacter.identifier);
        if (this.gameCharacter.isTemporaryCopy) {
          this.gameCharacter.destroy();
        } else {
          this.gameCharacter.leaveCurrentTable('graveyard');
        }
        SoundEffect.play(PresetSound.sweep);
      }
    };

    const tokenSettings: ContextMenuAction = {
      name: this.i18n.t('char.tokenSettings'),
      action: null,
      subActions: [
        ...(this.is2DMode ? [] : [
          contextMenuToggleCheck({
            get: () => !this.isNotRide,
            set: (v) => { this.isNotRide = !v; },
            on: this.i18n.t('char.stackOn'),
            off: this.i18n.t('char.stackOff'),
            after,
          }),
          contextMenuToggleCheck({
            get: () => this.isAltitudeIndicate,
            set: (v) => { this.isAltitudeIndicate = v; },
            on: this.i18n.t('char.altitudeOn'),
            off: this.i18n.t('char.altitudeOff'),
            after,
          }),
        ]),
        contextMenuToggleCheck({
          get: () => this.isDropShadow,
          set: (v) => { this.isDropShadow = v; },
          on: this.i18n.t('char.shadowOn'),
          off: this.i18n.t('char.shadowOff'),
          after,
        }),
        contextMenuToggleCheck({
          get: () => hasFace && this.isUseIconToOverviewImage,
          set: (v) => {
            if (!this.hasOverviewFaceIcon()) return;
            this.isUseIconToOverviewImage = v;
          },
          on: this.i18n.t('char.overviewFaceOn'),
          off: this.i18n.t('char.overviewFaceOff'),
          after,
          disabled: !hasFace,
          error: hasFace ? null : this.i18n.t('char.overviewFaceRequired'),
        }),
        contextMenuToggleCheck({
          get: () => !!(this.appearanceHost as any)?.isShowChatBubble,
          set: (v) => {
            const host = this.appearanceHost;
            if (!host) return;
            host.mutateAppearance(() => { (host as any).isShowChatBubble = v; });
          },
          on: this.i18n.t('char.chatBubbleOn'),
          off: this.i18n.t('char.chatBubbleOff'),
          tip: this.i18n.t('char.chatBubbleTip'),
          after,
        }),
        contextMenuToggleCheck({
          get: () => this.gameCharacter.isAllowsChat,
          set: (v) => { this.gameCharacter.isAllowsChat = v; },
          on: this.i18n.t('char.chatOn'),
          off: this.i18n.t('char.chatOff'),
          after,
        }),
      ],
    };

    const appearanceFx: ContextMenuAction = {
      name: this.i18n.t('char.appearanceFx'),
      action: null,
      // Root-menu altitude meter (3D). Must stay on a top-level action.
      ...(this.is2DMode ? {} : { altitudeHande: this.appearanceHost }),
      subActions: [
        this.characterFxMenu.makeImageEffectMenu(this.appearanceHost),
        this.characterFxMenu.makeAuraMenu(this.appearanceHost),
        this.characterFxMenu.makeRingMenu(this.appearanceHost),
        ...(this.is2DMode ? [
          this.characterFxMenu.makeTokenFrameMenu(this.appearanceHost),
          this.characterFxMenu.makePushPinMenu(this.appearanceHost),
        ] : []),
        this.characterFxMenu.makeClueLinkMenu(this.appearanceHost),
        this.characterFxMenu.makeStatusMenu(this.gameCharacter),
      ],
    };

    return this.joinContextMenuGroups([
      // Frequent: clipboard prefix adds Copy/Cut above this
      [
        advancedCopy,
        {
          name: this.i18n.t('char.moveTo'),
          action: null,
          subActions: [
            {
              name: this.i18n.t('char.commonInventory'),
              action: () => {
                if (this.characterToken) {
                  this.removeTokenFromTable(this.characterToken);
                  SoundEffect.play(PresetSound.piecePut);
                  return;
                }
                EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
                this.gameCharacter.leaveCurrentTable('common');
                this.selectionService.remove(this.gameCharacter);
                SoundEffect.play(PresetSound.piecePut);
              }
            },
            {
              name: this.i18n.t('char.personalInventory'),
              action: () => {
                if (this.characterToken) {
                  this.removeTokenFromTable(this.characterToken);
                  SoundEffect.play(PresetSound.piecePut);
                  return;
                }
                EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
                this.gameCharacter.leaveCurrentTable(Network.peerId);
                this.selectionService.remove(this.gameCharacter);
                SoundEffect.play(PresetSound.piecePut);
              }
            },
            {
              name: this.characterToken?.isTemporaryCopy || this.gameCharacter.isTemporaryCopy
                ? this.i18n.t('char.deleteTemporaryCopy')
                : this.i18n.t('char.graveyard'),
              action: () => {
                if (this.characterToken) {
                  this.removeTokenFromTable(this.characterToken);
                  SoundEffect.play(PresetSound.sweep);
                  return;
                }
                EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
                this.selectionService.remove(this.gameCharacter);
                if (this.gameCharacter.isTemporaryCopy) {
                  this.gameCharacter.destroy();
                } else {
                  this.gameCharacter.leaveCurrentTable('graveyard');
                }
                SoundEffect.play(PresetSound.sweep);
              }
            },
          ]
        },
        deleteAction,
      ],
      // Identity / combat
      [
        {
          name: this.isHideIn ? this.i18n.t('char.revealPosition') : this.i18n.t('char.selfOnlyStealth'),
          hotkey: 'H',
          action: () => {
            const host = this.appearanceHost;
            if (!host) return;
            if (this.isHideIn) {
              host.owner = '';
              SoundEffect.play(PresetSound.piecePut);
            } else {
              if (!GameCharacter.isStealthMode && !PeerCursor.myCursor.isGMMode) {
                this.modalService.open(ConfirmationComponent, {
                  title: this.i18n.t('char.stealthTitle'),
                  text: this.i18n.t('char.stealthText'),
                  help: this.i18n.t('char.stealthHelp'),
                  type: ConfirmationType.OK,
                  materialIcon: 'disabled_visible'
                });
              }
              host.owner = Network.peer.userId;
              if (this.gameCharacter && !this.gameCharacter.visionOwner) {
                this.gameCharacter.visionOwner = Network.peer.userId;
              }
              SoundEffect.play(PresetSound.sweep);
              EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
            }
            EventSystem.call('UPDATE_INVENTORY', true);
          },
        },
        this.characterFxMenu.makeMyTokenMenu(this.gameCharacter),
        this.characterFxMenu.makeCombatMenu(this.gameCharacter),
      ],
      // Image (next = frequent; switch list only when 3+)
      [
        hasMultiImage ? {
          name: this.i18n.t('char.nextImage'),
          action: () => { this.nextImage(); },
        } : null,
        imageCount > 2 ? {
          name: this.i18n.t('char.imageSwitch'),
          action: null,
          subActions: this.gameCharacter.imageFiles.map((image, i) => ({
            name: `${this.gameCharacter.currntImageIndex == i ? '◉' : '○'}`,
            action: () => { this.changeImage(i); },
            default: this.gameCharacter.currntImageIndex == i,
            icon: image,
            checkBox: 'radio' as const
          }))
        } : null,
      ],
      // Panels
      [
        { name: this.i18n.t('char.showDetail'), action: () => { this.showDetail(this.gameCharacter); } },
        { name: this.i18n.t('char.showChatPalette'), action: () => { this.showChatPalette(this.gameCharacter); }, disabled: !this.gameCharacter.isAllowsChat },
        { name: this.i18n.t('char.standSetting'), action: () => { this.showStandSetting(this.gameCharacter); }, disabled: !this.gameCharacter.isAllowsChat },
        ...this.gameCharacter.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => {
              if (StringUtil.sameOrigin(url)) {
                window.open(url.trim(), '_blank', 'noopener');
              } else {
                this.modalService.open(OpenUrlComponent, { url: url, title: this.gameCharacter.name, subTitle: urlElement.name });
              }
            },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? this.i18n.t('char.invalidUrl') : null,
            isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
          };
        }),
      ],
      // Appearance / FX (+ root altitude meter) and Token settings at L1
      [appearanceFx, tokenSettings],
      // Table presence
      [
        contextMenuToggleCheck({
          get: () => this.gameCharacter.isInventoryIndicate,
          set: (v) => { this.gameCharacter.isInventoryIndicate = v; },
          on: this.i18n.t('char.inventoryOn'),
          off: this.i18n.t('char.inventoryOff'),
          after,
        }),
        ...(this.characterToken ? [contextMenuToggleCheck({
          get: () => !!this.characterToken.isMajorMarker,
          set: (v) => {
            if (!this.characterToken) return;
            const viewId = TabletopObject.resolveViewTableIdentifier();
            if (v) {
              CharacterToken.reconcileMajor(this.characterToken.characterId, viewId, this.characterToken.identifier);
            } else {
              this.characterToken.isMajorMarker = false;
              this.characterToken.update();
              CharacterToken.reconcileMajor(this.characterToken.characterId, viewId);
            }
          },
          on: this.i18n.t('char.majorMarkerOn'),
          off: this.i18n.t('char.majorMarkerOff'),
          after,
        })] : []),
        this.characterFxMenu.makeVisionMenu(this.appearanceHost),
      ],
    ]);
  }

  /** Flatten menu groups with a single separator between non-empty groups. */
  private joinContextMenuGroups(groups: (ContextMenuAction | null)[][]): ContextMenuAction[] {
    const out: ContextMenuAction[] = [];
    for (const group of groups) {
      const items = group.filter((a): a is ContextMenuAction => !!a);
      if (!items.length) continue;
      if (out.length) out.push(ContextMenuSeparator);
      out.push(...items);
    }
    return out;
  }

  onDoubleClick(e: Event) {
    if (shouldIgnoreTabletopDoubleClick(e)) return;
    e.stopPropagation();
    this.showDetail(this.gameCharacter);
  }

  private showDetail(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    let title = this.i18n.t('char.sheetTitle');
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = {
      title: title, left: coordinate.x - 270, top: coordinate.y - 240, width: 540, height: 480,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    let component = this.panelService.open<CharacterSettingsComponent>(CharacterSettingsComponent, option);
    component.character = gameObject;
    component.token = this.characterToken;
  }

  private showChatPalette(gameObject: GameCharacter) {
    if (!gameObject || !gameObject.isAllowsChat) return;
    const tourId = PanelService.tourIdChatPalette(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 620, height: 350, tourPanelId: tourId };
    let component = this.panelService.open<ChatPaletteComponent>(ChatPaletteComponent, option);
    component.character = gameObject;
  }

  private showStandSetting(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    const tourId = PanelService.tourIdStandSetting(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 400, top: coordinate.y - 175, width: 690, height: 540, tourPanelId: tourId };
    let component = this.panelService.open<StandSettingComponent>(StandSettingComponent, option);
    component.character = gameObject;
  }

  changeImage(index: number) {
    if (this.GuestMode()) return;
    if (this.gameCharacter.currntImageIndex != index) {
      this.gameCharacter.currntImageIndex = index;
      this.syncViewPlacement();
      if (!this.isHideIn && this.gameCharacter.isVisibleOnTable) SoundEffect.play(PresetSound.surprise);
      EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
      EventSystem.trigger('UPDATE_INVENTORY', null);
    }
  }

  nextImage() {
    if (this.gameCharacter.imageFiles.length <= 1) return;
    if (this.gameCharacter.currntImageIndex + 1 >= this.gameCharacter.imageFiles.length) {
      this.changeImage(0);
    } else {
      this.changeImage(this.gameCharacter.currntImageIndex + 1);
    }
  }
}
