import { Network } from '@udonarium/core/system';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';

export type TourRequire =
  | 'ack'
  | 'panel-open'
  | 'gesture-pan'
  | 'gesture-wheel-pan'
  | 'gesture-zoom'
  | 'context-menu'
  | 'click'
  | 'key-move'
  | 'select-object'
  | 'path-draft'
  | 'table-ping';

export interface GuidedTourStep {
  id: string;
  titleKey: string;
  bodyKey: string;
  /** Optional mobile/touch-specific body copy. */
  bodyKeyMobile?: string;
  target?: string;
  /** After panel-open succeeds, spotlight this instead of `target` (usually the opened panel). */
  focusTarget?: string;
  require: TourRequire;
  tourId?: string;
  chapter?: string;
  skipIfGuest?: boolean;
  skipIfNoSceneTools?: boolean;
  /** Skip on phone/tablet compact layout (desktop-only gestures). */
  skipIfMobile?: boolean;
  /** When true, panel-open auto-advances (e.g. Connection → room explain). */
  autoAdvance?: boolean;
}

function menuOpen(
  id: string,
  tourId: string,
  require: 'panel-open' | 'click',
  opts?: { skipIfGuest?: boolean; skipIfNoSceneTools?: boolean; chapter?: string; autoAdvance?: boolean },
): GuidedTourStep {
  return {
    id,
    titleKey: `tour.step.${id}.title`,
    bodyKey: `tour.step.${id}.body`,
    target: `[data-tour-id="${tourId}"]`,
    focusTarget: require === 'panel-open' ? `[data-tour-panel="${tourId}"]` : undefined,
    tourId,
    require,
    chapter: opts?.chapter ?? 'menu',
    skipIfGuest: opts?.skipIfGuest,
    skipIfNoSceneTools: opts?.skipIfNoSceneTools,
    autoAdvance: opts?.autoAdvance,
  };
}

export function buildGuidedTourSteps(isMobile = false): GuidedTourStep[] {
  if (isMobile) return buildMobileGuidedTourSteps();
  return [
    // Chapter 1: room + save — open Connection first, then explain; folder backup before ZIP
    {
      id: 'roomChapter',
      titleKey: 'tour.step.roomChapter.title',
      bodyKey: 'tour.step.roomChapter.body',
      require: 'ack',
      chapter: 'room',
    },
    menuOpen('connection', 'menu.connection', 'panel-open', { chapter: 'room', autoAdvance: true }),
    {
      id: 'roomHow',
      titleKey: 'tour.step.roomHow.title',
      bodyKey: 'tour.step.roomHow.body',
      target: '[data-tour-panel="menu.connection"]',
      tourId: 'menu.connection',
      require: 'ack',
      chapter: 'room',
    },
    {
      id: 'saveFolder',
      titleKey: 'tour.step.saveFolder.title',
      bodyKey: 'tour.step.saveFolder.body',
      target: '[data-tour-panel="menu.connection"]',
      tourId: 'menu.connection',
      require: 'ack',
      chapter: 'room',
    },
    {
      id: 'saveZip',
      titleKey: 'tour.step.saveZip.title',
      bodyKey: 'tour.step.saveZip.body',
      target: '[data-tour-panel="menu.connection"]',
      tourId: 'menu.connection',
      require: 'ack',
      chapter: 'room',
    },

    // Chapter 2: other menus
    {
      id: 'menuChapter',
      titleKey: 'tour.step.menuChapter.title',
      bodyKey: 'tour.step.menuChapter.body',
      require: 'ack',
      chapter: 'menu',
    },
    menuOpen('chat', 'menu.chat', 'panel-open'),
    menuOpen('table', 'menu.table', 'panel-open', { skipIfGuest: true }),
    menuOpen('images', 'menu.images', 'panel-open', { skipIfGuest: true }),
    menuOpen('music', 'menu.music', 'panel-open', { skipIfGuest: true }),
    menuOpen('toolbox', 'menu.toolbox', 'click', { skipIfGuest: true }),
    menuOpen('combat', 'menu.combat', 'panel-open'),
    menuOpen('sceneTools', 'menu.sceneTools', 'panel-open', { skipIfNoSceneTools: true }),
    menuOpen('scenePreset', 'menu.scenePreset', 'panel-open', { skipIfGuest: true }),
    menuOpen('scenarioText', 'menu.scenarioText', 'panel-open', { skipIfGuest: true }),
    menuOpen('inventory', 'menu.inventory', 'panel-open', { skipIfGuest: true }),
    menuOpen('notes', 'menu.notes', 'panel-open', { skipIfGuest: true }),
    menuOpen('settings', 'menu.settings', 'click'),

    // Chapter 3: table
    {
      id: 'tableChapter',
      titleKey: 'tour.step.tableChapter.title',
      bodyKey: 'tour.step.tableChapter.body',
      require: 'ack',
      chapter: 'table',
    },
    {
      id: 'mapPan',
      titleKey: 'tour.step.mapPan.title',
      bodyKey: 'tour.step.mapPan.body',
      bodyKeyMobile: 'tour.step.mapPan.bodyMobile',
      target: '[data-tour-id="table.layer"]',
      require: 'gesture-pan',
      chapter: 'table',
    },
    {
      id: 'mapWheel',
      titleKey: 'tour.step.mapWheel.title',
      bodyKey: 'tour.step.mapWheel.body',
      target: '[data-tour-id="table.layer"]',
      require: 'gesture-wheel-pan',
      chapter: 'table',
      skipIfMobile: true,
    },
    {
      id: 'mapZoom',
      titleKey: 'tour.step.mapZoom.title',
      bodyKey: 'tour.step.mapZoom.body',
      bodyKeyMobile: 'tour.step.mapZoom.bodyMobile',
      target: '[data-tour-id="table.layer"]',
      require: 'gesture-zoom',
      chapter: 'table',
    },
    {
      id: 'contextMenu',
      titleKey: 'tour.step.contextMenu.title',
      bodyKey: 'tour.step.contextMenu.body',
      bodyKeyMobile: 'tour.step.contextMenu.bodyMobile',
      target: '[data-tour-id="table.layer"]',
      require: 'context-menu',
      chapter: 'table',
    },

    // Chapter 4: controls
    {
      id: 'controlsChapter',
      titleKey: 'tour.step.controlsChapter.title',
      bodyKey: 'tour.step.controlsChapter.body',
      target: '[data-tour-id="table.layer"]',
      require: 'select-object',
      chapter: 'controls',
    },
    {
      id: 'controlsWasd',
      titleKey: 'tour.step.controlsWasd.title',
      bodyKey: 'tour.step.controlsWasd.body',
      target: '[data-tour-id="table.layer"]',
      require: 'key-move',
      chapter: 'controls',
      skipIfMobile: true,
    },
    {
      id: 'controlsDelete',
      titleKey: 'tour.step.controlsDelete.title',
      bodyKey: 'tour.step.controlsDelete.body',
      bodyKeyMobile: 'tour.step.controlsDelete.bodyMobile',
      require: 'ack',
      chapter: 'controls',
    },
    {
      id: 'controlsClipboard',
      titleKey: 'tour.step.controlsClipboard.title',
      bodyKey: 'tour.step.controlsClipboard.body',
      bodyKeyMobile: 'tour.step.controlsClipboard.bodyMobile',
      require: 'ack',
      chapter: 'controls',
    },
    {
      id: 'controlsUndo',
      titleKey: 'tour.step.controlsUndo.title',
      bodyKey: 'tour.step.controlsUndo.body',
      bodyKeyMobile: 'tour.step.controlsUndo.bodyMobile',
      require: 'ack',
      chapter: 'controls',
    },
    {
      id: 'controlsPath',
      titleKey: 'tour.step.controlsPath.title',
      bodyKey: 'tour.step.controlsPath.body',
      bodyKeyMobile: 'tour.step.controlsPath.bodyMobile',
      target: '[data-tour-id="table.layer"]',
      require: 'path-draft',
      chapter: 'controls',
      skipIfGuest: true,
      skipIfMobile: true,
    },
    {
      id: 'controlsPing',
      titleKey: 'tour.step.controlsPing.title',
      bodyKey: 'tour.step.controlsPing.body',
      target: '[data-tour-id="table.layer"]',
      require: 'table-ping',
      chapter: 'controls',
      // Long-press is reserved for context menu on touch; ping conflicts.
      skipIfMobile: true,
    },
    {
      id: 'saveGuide',
      titleKey: 'tour.step.saveGuide.title',
      bodyKey: 'tour.step.saveGuide.body',
      require: 'ack',
      chapter: 'controls',
    },
  ];
}

/** Phone/tablet tour: primary nav + map HUD gestures (no wheel / WASD / path). */
function buildMobileGuidedTourSteps(): GuidedTourStep[] {
  return [
    {
      id: 'roomChapter',
      titleKey: 'tour.step.roomChapter.title',
      bodyKey: 'tour.step.roomChapter.bodyMobile',
      require: 'ack',
      chapter: 'room',
    },
    menuOpen('connection', 'menu.connection', 'panel-open', { chapter: 'room', autoAdvance: true }),
    {
      id: 'roomHow',
      titleKey: 'tour.step.roomHow.title',
      bodyKey: 'tour.step.roomHow.body',
      target: '[data-tour-panel="menu.connection"]',
      tourId: 'menu.connection',
      require: 'ack',
      chapter: 'room',
    },
    {
      id: 'saveZip',
      titleKey: 'tour.step.saveZip.title',
      bodyKey: 'tour.step.saveZip.bodyMobile',
      target: '[data-tour-panel="menu.connection"]',
      tourId: 'menu.connection',
      require: 'ack',
      chapter: 'room',
    },
    {
      id: 'menuChapter',
      titleKey: 'tour.step.menuChapter.title',
      bodyKey: 'tour.step.menuChapter.bodyMobile',
      require: 'ack',
      chapter: 'menu',
    },
    menuOpen('chat', 'menu.chat', 'panel-open'),
    menuOpen('combat', 'menu.combat', 'panel-open'),
    menuOpen('inventory', 'menu.inventory', 'panel-open', { skipIfGuest: true }),
    menuOpen('more', 'menu.more', 'click'),
    {
      id: 'tableChapter',
      titleKey: 'tour.step.tableChapter.title',
      bodyKey: 'tour.step.tableChapter.bodyMobile',
      require: 'ack',
      chapter: 'table',
    },
    {
      id: 'mapPan',
      titleKey: 'tour.step.mapPan.title',
      bodyKey: 'tour.step.mapPan.bodyMobile',
      target: '[data-tour-id="table.layer"]',
      require: 'gesture-pan',
      chapter: 'table',
    },
    {
      id: 'mapZoom',
      titleKey: 'tour.step.mapZoom.title',
      bodyKey: 'tour.step.mapZoom.bodyMobile',
      target: '[data-tour-id="table.layer"]',
      require: 'gesture-zoom',
      chapter: 'table',
    },
    {
      id: 'contextMenu',
      titleKey: 'tour.step.contextMenu.title',
      bodyKey: 'tour.step.contextMenu.bodyMobile',
      target: '[data-tour-id="hud.add"]',
      tourId: 'hud.add',
      require: 'click',
      chapter: 'table',
    },
    {
      id: 'controlsChapter',
      titleKey: 'tour.step.controlsChapter.title',
      bodyKey: 'tour.step.controlsChapter.bodyMobile',
      target: '[data-tour-id="table.layer"]',
      require: 'select-object',
      chapter: 'controls',
    },
    {
      id: 'controlsPing',
      titleKey: 'tour.step.controlsPing.title',
      bodyKey: 'tour.step.controlsPing.bodyMobile',
      target: '[data-tour-id="table.layer"]',
      require: 'table-ping',
      chapter: 'controls',
    },
    {
      id: 'saveGuide',
      titleKey: 'tour.step.saveGuide.title',
      bodyKey: 'tour.step.saveGuide.bodyMobile',
      require: 'ack',
      chapter: 'controls',
    },
  ];
}

export function shouldSkipStep(step: GuidedTourStep, isMobile = false): boolean {
  if (step.skipIfMobile && isMobile) return true;
  if (step.skipIfGuest && Network.GuestMode()) return true;
  if (step.skipIfNoSceneTools && !SceneToolPermission.instance.canOpenPanel) return true;
  if (step.target && typeof document !== 'undefined' && !document.querySelector(step.target)) {
    if (step.require === 'panel-open' || step.require === 'click') return true;
  }
  return false;
}
