import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { translate } from 'i18n';

export const SCENARIO_TEXT_MAX_BYTES = 8 * 1024;

@SyncObject('scenario-text')
export class ScenarioText extends ObjectNode {
  @SyncVar() title: string = '';
  @SyncVar() body: string = '';

  get isOverLimit(): boolean {
    try {
      return new Blob([this.body || '']).size > SCENARIO_TEXT_MAX_BYTES;
    } catch {
      return (this.body || '').length > SCENARIO_TEXT_MAX_BYTES;
    }
  }

  static create(title?: string): ScenarioText {
    const item = new ScenarioText();
    item.title = title || translate('scenarioText.defaultTitle');
    item.initialize();
    return item;
  }
}
