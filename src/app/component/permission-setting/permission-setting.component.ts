import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';

import { I18nService } from 'service/i18n.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'permission-setting',
  templateUrl: './permission-setting.component.html',
  styleUrls: ['../shared/settings-ui.css', './permission-setting.component.css'],
  standalone: false
})
export class PermissionSettingComponent implements OnInit, OnDestroy {
  /** When true (inside room create/edit), allow edits without requiring GM flag yet. */
  @Input() embedMode = false;

  get isGMMode(): boolean {
    return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false;
  }

  get canEditPerms(): boolean {
    return this.embedMode || this.isGMMode;
  }

  get scenePerm() { return SceneToolPermission.instance; }

  get sceneCanCreateLight(): boolean { return this.scenePerm.playerCanCreateLight; }
  set sceneCanCreateLight(v: boolean) { this.scenePerm.playerCanCreateLight = !!v; }
  get sceneCanCreateWall(): boolean { return this.scenePerm.playerCanCreateWall; }
  set sceneCanCreateWall(v: boolean) { this.scenePerm.playerCanCreateWall = !!v; }
  get sceneCanCreateRect(): boolean { return this.scenePerm.playerCanCreateRect; }
  set sceneCanCreateRect(v: boolean) { this.scenePerm.playerCanCreateRect = !!v; }
  get sceneCanCreateEllipse(): boolean { return this.scenePerm.playerCanCreateEllipse; }
  set sceneCanCreateEllipse(v: boolean) { this.scenePerm.playerCanCreateEllipse = !!v; }
  get sceneCanCreatePolygon(): boolean { return this.scenePerm.playerCanCreatePolygon; }
  set sceneCanCreatePolygon(v: boolean) { this.scenePerm.playerCanCreatePolygon = !!v; }
  get sceneCanCreateFreehand(): boolean { return this.scenePerm.playerCanCreateFreehand; }
  set sceneCanCreateFreehand(v: boolean) { this.scenePerm.playerCanCreateFreehand = !!v; }
  get sceneCanCreateText(): boolean { return this.scenePerm.playerCanCreateText; }
  set sceneCanCreateText(v: boolean) { this.scenePerm.playerCanCreateText = !!v; }

  get sceneCanModifyLight(): boolean { return this.scenePerm.playerCanModifyLight; }
  set sceneCanModifyLight(v: boolean) { this.scenePerm.playerCanModifyLight = !!v; }
  get sceneCanModifyWall(): boolean { return this.scenePerm.playerCanModifyWall; }
  set sceneCanModifyWall(v: boolean) { this.scenePerm.playerCanModifyWall = !!v; }
  get sceneCanModifyDrawing(): boolean { return this.scenePerm.playerCanModifyDrawing; }
  set sceneCanModifyDrawing(v: boolean) { this.scenePerm.playerCanModifyDrawing = !!v; }

  get playerCanLoadZip(): boolean { return this.scenePerm.playerCanLoadZip; }
  set playerCanLoadZip(v: boolean) { this.scenePerm.playerCanLoadZip = !!v; }
  get playerCanLoadRoom(): boolean { return this.scenePerm.playerCanLoadRoom; }
  set playerCanLoadRoom(v: boolean) { this.scenePerm.playerCanLoadRoom = !!v; }

  get playerCanControlWeather(): boolean { return this.scenePerm.playerCanControlWeather; }
  set playerCanControlWeather(v: boolean) { this.scenePerm.playerCanControlWeather = !!v; }
  get playerCanControlDayNight(): boolean { return this.scenePerm.playerCanControlDayNight; }
  set playerCanControlDayNight(v: boolean) { this.scenePerm.playerCanControlDayNight = !!v; }

  get playerCanOpenTable(): boolean { return this.scenePerm.playerCanOpenTable; }
  set playerCanOpenTable(v: boolean) { this.scenePerm.playerCanOpenTable = !!v; }
  get playerCanOpenImages(): boolean { return this.scenePerm.playerCanOpenImages; }
  set playerCanOpenImages(v: boolean) { this.scenePerm.playerCanOpenImages = !!v; }
  get playerCanOpenMusic(): boolean { return this.scenePerm.playerCanOpenMusic; }
  set playerCanOpenMusic(v: boolean) { this.scenePerm.playerCanOpenMusic = !!v; }
  get playerCanOpenToolbox(): boolean { return this.scenePerm.playerCanOpenToolbox; }
  set playerCanOpenToolbox(v: boolean) { this.scenePerm.playerCanOpenToolbox = !!v; }
  get playerCanOpenScenePreset(): boolean { return this.scenePerm.playerCanOpenScenePreset; }
  set playerCanOpenScenePreset(v: boolean) { this.scenePerm.playerCanOpenScenePreset = !!v; }
  get playerCanOpenScenarioText(): boolean { return this.scenePerm.playerCanOpenScenarioText; }
  set playerCanOpenScenarioText(v: boolean) { this.scenePerm.playerCanOpenScenarioText = !!v; }
  get playerCanOpenInventory(): boolean { return this.scenePerm.playerCanOpenInventory; }
  set playerCanOpenInventory(v: boolean) { this.scenePerm.playerCanOpenInventory = !!v; }
  get playerCanOpenNotes(): boolean { return this.scenePerm.playerCanOpenNotes; }
  set playerCanOpenNotes(v: boolean) { this.scenePerm.playerCanOpenNotes = !!v; }

  get sceneAllCreate(): boolean {
    const p = this.scenePerm;
    return p.playerCanCreateLight && p.playerCanCreateWall
      && p.playerCanCreateRect && p.playerCanCreateEllipse
      && p.playerCanCreatePolygon && p.playerCanCreateFreehand
      && p.playerCanCreateText;
  }
  get sceneAllModify(): boolean {
    const p = this.scenePerm;
    return p.playerCanModifyLight && p.playerCanModifyWall && p.playerCanModifyDrawing;
  }
  get allMenusEnabled(): boolean { return this.scenePerm.allMenusEnabled; }

  setAllSceneCreate(v: boolean) { this.scenePerm.setAllCreate(v); }
  setAllSceneModify(v: boolean) { this.scenePerm.setAllModify(v); }
  setAllMenus(v: boolean) { this.scenePerm.setAllMenus(v); }

  constructor(
    private panelService: PanelService,
    private i18n: I18nService,
  ) { }

  ngOnInit() {
    if (!this.embedMode) {
      Promise.resolve().then(() => this.refreshTitle());
    }
    EventSystem.register(this)
      .on('LOCALE_CHANGED', () => { if (!this.embedMode) this.refreshTitle(); })
      .on('CHANGE_GM_MODE', () => { if (!this.embedMode) this.refreshTitle(); });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  private refreshTitle() {
    this.panelService.title = this.i18n.t('peer.permissionManage');
  }
}
