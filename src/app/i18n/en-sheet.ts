import { I18nDictionary } from './types';
import { zhTW_sheet } from './zh-TW-sheet';

export const en_sheet: I18nDictionary = {
  ...zhTW_sheet,
  'sheet.toggleEdit': 'Toggle edit', 'sheet.changeFrontImage': 'Change front image', 'sheet.changeBackImage': 'Change back image', 'sheet.changeAllBackImages': 'Change all card back images', 'sheet.changeFloorImage': 'Change floor image', 'sheet.changeWallImage': 'Change wall image', 'sheet.changeDiceImage': 'Change dice face image', 'sheet.imageReplaceDelete': 'Replace/Delete image', 'sheet.imageSet': 'Set image', 'sheet.faceIconAdd': 'Add face icon', 'sheet.faceIconSet': 'Set face icon', 'sheet.changeImage': 'Change image', 'sheet.createCopy': 'Create copy', 'sheet.cloneCharacter': 'Duplicate character', 'sheet.download': 'Export', 'sheet.import': 'Import', 'sheet.exportCcfoliaJson': 'Download as JSON', 'sheet.location.table': 'Table', 'sheet.location.common': 'Common storage', 'sheet.location.personal': 'Personal storage', 'sheet.location.graveyard': 'Graveyard', 'sheet.changeShadow': 'Change image shadow', 'sheet.deleteFaceIcon': 'Delete face icon', 'sheet.switchImageSettings': 'Image settings', 'sheet.showChatPalette': 'Show chat palette', 'sheet.standSettings': 'Stand settings', 'sheet.addItem': 'Add item', 'sheet.data.title': 'Title', 'sheet.data.tag': 'Tag', 'sheet.cardBack': 'Card (back)', 'sheet.title.terrain': 'Terrain settings - {{name}}', 'sheet.title.card': 'Card settings - {{name}}', 'sheet.title.cardStack': 'Deck settings - {{name}}', 'sheet.title.tableMask': 'Map mask settings - {{name}}', 'sheet.title.textNote': 'Shared note settings - {{name}}', 'sheet.title.diceSymbol': 'Dice symbol settings - {{name}}', 'sheet.title.character': 'Character sheet - {{name}}', 'sheet.title.range': 'Range/area settings - {{name}}', 'sheet.logOpened': '{{title}} opened', 'sheet.data.type.normal': 'Normal', 'sheet.data.type.number': 'Number', 'sheet.data.type.resource': 'Resource', 'sheet.data.type.ability': 'Ability score', 'sheet.data.type.check': 'Checkbox', 'sheet.data.type.note': 'Note', 'sheet.data.type.url': 'Reference URL', 'sheet.data.heightImage': '0 = use image', 'sheet.data.none': 'None',
  'palette.unnamedTab': '(Unnamed tab)', 'palette.editing': 'Editing chat palette', 'palette.placeholder': 'Chat palette', 'palette.edit': 'Edit chat palette', 'palette.confirm': 'Confirm chat palette', 'palette.title': '{{name}}\'s chat palette', 'palette.helpTitle': 'Using chat notation and the chat palette',
  'palette.help': `Parameter commands and dice bot commands ignore full-width/half-width forms and letter case. Separate combined commands with spaces: parameter command, dice bot command, then chat text.

Prepare chat messages in the palette, one per line. Click once to place it in the input; double-click to send it.

・Parameter commands
Start a message with :parameter+value, :parameter-value, or :parameter=value to modify character parameters. Use > to substitute a dice-bot command without rolling. Separate multiple operations with :; parameter commands are not shown in chat.

Examples)
　:HP+2d6:MP-4　Recover 2d6 HP and spend 4 MP.
　:HP-2d6　2d6+{STR}+2

Resources never exceed their maximum. For checkboxes, + enables and - disables them.

・Dice bot commands
Send a dice bot command to roll dice or consult tables. Refer to each game system's dice bot documentation for available commands.

・Parameter references
Wrap a parameter name in { and } to replace it with its value when selecting or sending a palette line. Prefix the name with $ to reference the value after parameter operations. {$1}, {$2}, and so on reference each operation's actual change.

・Additional values
Write //name=value on a palette line to make a value available as {name}; it cannot be modified by commands.

・Newlines and spaces
Write \\n to insert a newline. Write \\s for a half-width space and \\ｓ for a full-width space.

・Ruby text
Prefix text with | and wrap its reading in 《 and 》.

・Floating dialog
When a character sends chat, text wrapped in 「 and 」 appears immediately above the token.`,
  'stand.sortNameList': 'Sort names while entering chat', 'stand.heightGlobal': 'Height (0 = keep original image): ', 'stand.keepOriginalImage': 'Keep original image', 'stand.common': 'Common settings', 'stand.list': 'Stand list', 'stand.listEmpty': 'No stand settings yet', 'stand.noOverview': 'Do not use a stand image in the overview', 'stand.add': 'Add stand setting', 'stand.restore': 'Restore recently deleted stand setting', 'stand.title': '{{name}}\'s stand settings', 'stand.deleteTitle': 'Delete stand setting', 'stand.deleteText': 'Delete this stand setting?', 'stand.helpTitle': 'Stand settings help', 'stand.changeImage': 'Change image', 'stand.condition': 'Condition: ', 'stand.condition.default': 'Default', 'stand.condition.image': 'Specified image', 'stand.condition.postfix': 'Chat suffix', 'stand.condition.postfixOrImage': 'Chat suffix or specified image', 'stand.condition.postfixAndImage': 'Chat suffix and specified image', 'stand.condition.selectedOnly': 'Only when selected', 'stand.showName': 'Show name tag', 'stand.applyImageEffect': 'Apply image effects', 'stand.applyRoll': 'Apply rotation', 'stand.speakingImage': 'Speaking image (APNG, etc.)', 'stand.test': 'Test (only visible to you)', 'stand.positionSpecialize': 'Per-stand position: ', 'stand.heightIndividual': 'Height (0 = unspecified): ', 'stand.unspecified': 'Unspecified', 'stand.postfixPlaceholder': 'One per line. A leading @ is removed from matching text.\r\n@angry\r\n@special move', 'stand.noCharacterImages': 'No character image or face icon is set', 'stand.testMessage': 'This is a test that only you can see. For finer stand adjustments, turn off “Fade out and automatically exit stands” in Personal settings.',
  'stand.help': `Set a character stand's name, position, image height, and the condition for displaying it when chat is sent.

Stand names can be selected from the chat window and chat palette. Different tags for the same character play separate entrance and exit animations.

Position and height can be set individually. If individual position is disabled and height is 0, the global settings are used. AdjY is relative to the stand image height.

“Specified image” matches the character image or face icon used for chat. A chat message ending with “@farewell” always dismisses the stand.

Priority, highest first:
　1. @farewell
　2. A name selected in the chat window or palette
　3. Specified image and chat suffix
　4. Specified image or chat suffix
　5. Chat suffix
　6. Specified image

If nothing matches, Default is used. Equal-priority matches are selected randomly.`,
  'sheet.data.cardBack': 'Card (back)',
  'stand.namePlaceholder': 'Name',
  'sheet.sendToChat': 'Send to chat',
  'sheet.placeholder.value': 'Value',
  'sheet.placeholder.opacity': 'Opacity',
  'sheet.placeholder.number': 'Number',
  'sheet.placeholder.note': 'Note',
  'sheet.placeholder.option': 'Option',
  'stand.tagLabel': 'Tag: ',
  'stand.tagPlaceholder': 'Tag',
  'stand.adjY': 'AdjY: ',
  'stand.posLabel': 'Pos: ',
  'sheet.modifier.div2': '÷2',
  'sheet.modifier.div3': '÷3 SRS,LHZ',
  'sheet.modifier.div4': '÷4',
  'sheet.modifier.div5': '÷5',
  'sheet.modifier.div6': '÷6 SW',
  'sheet.modifier.div10': '÷10',
  'sheet.modifier.dnd3e': 'D&D 3e～',
  'sheet.data.heightScale': '× size',
};
