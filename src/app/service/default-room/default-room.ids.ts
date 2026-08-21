/** Fixed sync ids for the two first-load default maps. */
export const DEFAULT_TABLE_3D_ID = 'gameTable';
export const DEFAULT_TABLE_2D_ID = 'gameTable_clue2d';
export const DEFAULT_BG_3D_IMAGE_ID = 'testTableBackgroundImage_image';
export const DEFAULT_BG_2D_IMAGE_ID = 'clueBoardBackgroundImage_image';

/** Default clue-board surface art (HD). */
export const CLUE_BOARD_BG_URL = './assets/images/clue-board/redboard.jpg';

/** Standing-mask fill: darker sticky yellow (ZIP clueMask bgcolor). */
export const CLUE_STICKY_YELLOW = '#9e811a';

export type DefaultRoomTranslate = (key: string, params?: Record<string, unknown>) => string;
