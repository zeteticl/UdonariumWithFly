import { translate } from 'i18n';
import { Attributes } from './core/synchronize-object/attributes';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { CompareOption, StringUtil } from './core/system/util/string-util';

@SyncObject('data')
export class DataElement extends ObjectNode {
  @SyncVar() name: string = '';
  @SyncVar() type: string = '';
  @SyncVar() currentValue: number | string;

  get isSimpleNumber(): boolean { return this.type != null && this.type === 'simpleNumber'; }
  get isNumberResource(): boolean { return this.type != null && this.type === 'numberResource'; }
  get isCheckProperty(): boolean { return this.type != null && this.type === 'checkProperty'; }
  get isNote(): boolean { return this.type != null && this.type === 'note'; }
  get isAbilityScore(): boolean { return this.type != null && this.type === 'abilityScore'; }
  get isUrl(): boolean { return this.type != null && this.type === 'url'; }

  oldLoggingValue: string;
  changeObserver: Function;

  public static create(name: string, value: number | string = '', attributes: Attributes = {}, identifier: string = ''): DataElement {
    let dataElement: DataElement;
    if (identifier && 0 < identifier.length) {
      dataElement = new DataElement(identifier);
    } else {
      dataElement = new DataElement();
    }
    dataElement.attributes = attributes;
    dataElement.name = name;
    // XML / getAttribute('name') read the attributes bag; keep SyncVar + attribute aligned
    // without setAttribute() (which would call update() before initialize()).
    if (name && dataElement.attributes['name'] !== name) {
      dataElement.attributes['name'] = name;
    }
    if (attributes) {
      if (attributes['type'] != null && !dataElement.type) dataElement.type = String(attributes['type']);
      if (attributes['currentValue'] != null && dataElement.currentValue == null) {
        dataElement.currentValue = attributes['currentValue'] as number | string;
      }
    }
    dataElement.value = value;
    dataElement.initialize();

    return dataElement;
  }

  /**
   * Room XML stores name/type/currentValue on the attributes bag (ObjectNode XmlAttributes).
   * Mirror them onto SyncVars so templates and sheet logic keep working after legacy load.
   */
  override parseAttributes(attributes: NamedNodeMap) {
    super.parseAttributes(attributes);
    const attrName = this.getAttribute('name');
    const attrType = this.getAttribute('type');
    const attrCurrent = this.attributes['currentValue'];
    if (attrName && !this.name) this.name = attrName;
    if (attrType && !this.type) this.type = attrType;
    if (this.currentValue == null && attrCurrent != null) this.currentValue = attrCurrent;
  }

  get loggingValue(): string {
    let ret: string;
    if (this.isSimpleNumber) {
      ret = `${this.value}`;
    } else if (this.isNumberResource) {
      ret = `${this.currentValue}/${this.value && this.value != 0 ? this.value : translate('common.unknown')}`;
    } else if (this.isCheckProperty) {
      ret = `${this.value ? translate('chat.op.checkOn') : translate('chat.op.checkOff')}`;
    } else if (this.isAbilityScore) {
      const modifire = this.calcAbilityScore();
      ret = `${this.value}`;
      if (this.currentValue) ret += `(${modifire >= 0 ? '+' : ''}${modifire})`;
    } else {
      ret = this.value == null ? '' : this.value.toString();
    }
    if (this.oldLoggingValue !== ret) {
      this.oldLoggingValue = ret;
      if (this.changeObserver) this.changeObserver();
    }
    return ret;
  }

  getElementsByName(name: string, option: CompareOption = CompareOption.None): DataElement[] {
    let children: DataElement[] = [];
    for (let child of this.children) {
      if (child instanceof DataElement) {
        if (StringUtil.equals(child.getAttribute('name'), name, option)) children.push(child);
        Array.prototype.push.apply(children, child.getElementsByName(name, option));
      }
    }
    return children;
  }

  getElementsByType(type: string, option: CompareOption = CompareOption.None): DataElement[] {
    let children: DataElement[] = [];
    for (let child of this.children) {
      if (child instanceof DataElement) {
        if (StringUtil.equals(child.getAttribute('type'), type, option)) children.push(child);
        Array.prototype.push.apply(children, child.getElementsByType(type, option));
      }
    }
    return children;
  }

  getFirstElementByName(name: string, option: CompareOption = CompareOption.None): DataElement {
    for (let child of this.children) {
      if (child instanceof DataElement) {
        if (StringUtil.equals(child.getAttribute('name'), name, option)) return child;
        let match = child.getFirstElementByName(name, option);
        if (match) return match;
      }
    }
    return null;
  }

  getFirstElementByNameUnsensitive(name: string, replacePattern: string|RegExp = null, replacement=''): DataElement {
    for (let child of this.children) {
      if (child instanceof DataElement) {
        let normalizeName = StringUtil.cr(StringUtil.toHalfWidth(name.replace(/[―ー—‐]/g, '-')).toLowerCase()).replace(/[\s\r\n]+/, ' ').trim();
        if (replacePattern != null) normalizeName = normalizeName.replace(replacePattern, replacement);
        if (StringUtil.cr(StringUtil.toHalfWidth(child.getAttribute('name').replace(/[―ー—‐]/g, '-')).toLowerCase()).replace(/[\s\r\n]+/, ' ').trim() === normalizeName) return child;
        let match = child.getFirstElementByNameUnsensitive(name, replacePattern, replacement);
        if (match) return match;
      }
    }
    return null;
  }

  calcAbilityScore(): number {
    if (!this.isAbilityScore || !this.value) return 0;
    let match;
    if (this.currentValue == null) {
      return +this.value;
    } else if (match = this.currentValue.toString().match(/^div(\d+)$/)) {
      return Math.floor(+this.value / +match[1]);
    // currently 3.0+ only
    } else if (match = this.currentValue.toString().match(/^DnD/)) {
      return Math.floor((+this.value - 10) / 2);
    } else {
      return +this.value;
    }
  }

  checkValue(): string {
    if (!this.isCheckProperty) return '0';
    let pair = (this.currentValue + '').trim().split(/[|｜]/g, 2);
    if (pair[1] == null) {
      pair[1] = '0'
      if (pair[0] == null || (pair[0].trim() === '' && !/[|｜]/.test(this.currentValue + ''))) pair[0] = '1';
    } 
    return pair[ this.value ? 0 : 1 ].trim();
  }
}
