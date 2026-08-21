import { XmlUtil } from '../system/util/xml-util';
import { Attributes } from './attributes';
import { GameObject, ObjectContext } from './game-object';
import { ObjectFactory } from './object-factory';
import { ObjectStore } from './object-store';

export interface XmlAttributes extends GameObject {
  toAttributes(): Attributes;
  parseAttributes(attributes: NamedNodeMap);
}

export interface InnerXml extends GameObject {
  innerXml(): string;
  parseInnerXml(element: Element);
}

const objectPropertyKeys = Object.getOwnPropertyNames(Object.prototype);
const arrayPropertyKeys = Object.getOwnPropertyNames(Array.prototype);

export class ObjectSerializer {
  private static _instance: ObjectSerializer
  static get instance(): ObjectSerializer {
    if (!ObjectSerializer._instance) ObjectSerializer._instance = new ObjectSerializer();
    return ObjectSerializer._instance;
  }

  private constructor() {
  };

  /** Stable object id for cross-refs (tableIdentifier, scene snaps). Not a SyncVar. */
  static readonly SYNC_ID_ATTR = 'syncId';

  toXml(gameObject: GameObject): string {
    let xml = '';
    let attributes = 'toAttributes' in gameObject ? (<XmlAttributes>gameObject).toAttributes() : ObjectSerializer.toAttributes(gameObject.toContext().syncData);
    let tagName = gameObject.aliasName;

    let attrStr = '';
    for (let name in attributes) {
      if (name === ObjectSerializer.SYNC_ID_ATTR) continue;
      if (attributes[name] === undefined) continue;
      let attribute = XmlUtil.encodeEntityReference(attributes[name] + '');
      attrStr += ' ' + name + '="' + attribute + '"';
    }
    // Persist identity so tableIdentifier / scene-preset snaps survive room reload.
    attrStr += ` ${ObjectSerializer.SYNC_ID_ATTR}="${XmlUtil.encodeEntityReference(gameObject.identifier)}"`;
    xml += `<${tagName + attrStr}>`;
    xml += 'innerXml' in gameObject ? (<InnerXml>gameObject).innerXml() : '';
    xml += `</${tagName}>`;
    return xml;
  }

  static toAttributes(syncData: Object): Attributes {
    let attributes = {};
    for (let syncVar in syncData) {
      let item = syncData[syncVar];
      let key = syncVar;
      let childAttr = ObjectSerializer.make2Attributes(item, key);
      for (let name in childAttr) {
        if (childAttr[name] !== undefined) attributes[name] = childAttr[name];
      }
    }
    return attributes;
  }

  private static make2Attributes(item: any, key: string): Attributes {
    let attributes = {};
    if (Array.isArray(item)) {
      let arrayAttributes = ObjectSerializer.array2attributes(item, key);
      for (let name in arrayAttributes) {
        if (arrayAttributes[name] !== undefined) attributes[name] = arrayAttributes[name];
      }
    } else if (typeof item === 'object') {
      let objAttributes = ObjectSerializer.object2attributes(item, key);
      for (let name in objAttributes) {
        if (objAttributes[name] !== undefined) attributes[name] = objAttributes[name];
      }
    } else {
      if (item !== undefined) attributes[key] = item;
    }
    return attributes;
  }

  private static object2attributes(obj: any, rootKey: string): Attributes {
    let attributes = {};
    for (let objKey in obj) {
      let item = obj[objKey];
      let key = rootKey + '.' + objKey;
      let childAttr = ObjectSerializer.make2Attributes(item, key);
      for (let name in childAttr) {
        if (childAttr[name] !== undefined) attributes[name] = childAttr[name];
      }
    }
    return attributes;
  }

  private static array2attributes(array: Array<any>, rootKey: string): Attributes {
    let attributes = {};
    let length = array.length;
    for (let i = 0; i < length; i++) {
      let item = array[i];
      let key = rootKey + '.' + i;
      let childAttr = ObjectSerializer.make2Attributes(item, key);
      for (let name in childAttr) {
        if (childAttr[name] !== undefined) attributes[name] = childAttr[name];
      }
    }
    return attributes;
  }

  parseXml(xml: string | Element): GameObject {
    let xmlElement: Element = null;
    if (typeof xml === 'string') {
      xmlElement = XmlUtil.xml2element(xml);
    } else {
      xmlElement = xml;
    }
    if (!xmlElement) {
      console.error('xmlElement is empty');
      return null;
    }

    const tagName = xmlElement.tagName;
    let syncId = xmlElement.getAttribute(ObjectSerializer.SYNC_ID_ATTR);
    if (syncId) {
      syncId = XmlUtil.decodeEntityReference(syncId);
      xmlElement.removeAttribute(ObjectSerializer.SYNC_ID_ATTR);
    }

    let gameObject: GameObject = null;
    try {
      // Reuse id only when free (clone while original exists still gets a new UUID).
      if (syncId && ObjectStore.instance.get(syncId) == null) {
        ObjectStore.instance.clearDeleted(syncId);
        gameObject = ObjectFactory.instance.create(tagName, syncId);
      } else {
        gameObject = ObjectFactory.instance.create(tagName);
      }
      if (!gameObject) return null;

      if ('parseAttributes' in gameObject) {
        (<XmlAttributes>gameObject).parseAttributes(xmlElement.attributes);
      } else {
        let context: ObjectContext = gameObject.toContext();
        ObjectSerializer.parseAttributes(context.syncData, xmlElement.attributes);
        gameObject.apply(context);
      }

      gameObject.initialize();
      if ('parseInnerXml' in gameObject) {
        (<InnerXml>gameObject).parseInnerXml(xmlElement);
      }
      try {
        gameObject.complement();
      } catch (e) {
        console.warn('[ObjectSerializer] complement failed; keeping object', tagName, syncId || gameObject.identifier, e);
      }

      return gameObject;
    } catch (e) {
      console.warn(
        '[ObjectSerializer] skip corrupt object',
        { tag: tagName, syncId: syncId || '', error: String((e as Error)?.message || e) },
        e
      );
      if (gameObject) {
        try {
          gameObject.destroy();
        } catch (destroyErr) {
          console.warn('[ObjectSerializer] destroy after parse failure failed', destroyErr);
        }
      }
      return null;
    }
  }

  static parseAttributes(syncData: Object, attributes: NamedNodeMap): Object {
    let length = attributes.length;
    for (let i = 0; i < length; i++) {
      let value = attributes[i].value;
      value = XmlUtil.decodeEntityReference(value);

      let split: string[] = attributes[i].name.split('.');
      let key: string | number = split[0];
      let obj: Object | Array<any> = syncData;

      if (key === ObjectSerializer.SYNC_ID_ATTR) continue;

      let pollutionKey = split.find(splitKey => objectPropertyKeys.includes(splitKey));
      if (pollutionKey != null) {
        console.log(`skip invalid key (${pollutionKey})`);
        continue;
      }

      if (1 < split.length) {
        ({ obj, key } = ObjectSerializer.attributes2object(split, obj, key));
        if (key == null) continue;
      }

      let type = typeof obj[key];
      if (type !== 'string' && obj[key] != null) {
        try {
          value = JSON.parse(value);
        } catch (e) {
          console.warn('[ObjectSerializer] skip corrupt attribute value', attributes[i].name, e);
          continue;
        }
      }
      obj[key] = value;
    }
    return syncData;
  }

  private static attributes2object(split: string[], obj: Object | any[], key: string | number) {
    // Parse hierarchy like foo.bar.0="abc"
    // Implemented, but not good XML practice; should not be used.
    let parentObj: Object | Array<any> = null;
    let length = split.length;
    for (let i = 0; i < length; i++) {
      let index = parseInt(split[i]);
      if (parentObj && !Number.isNaN(index) && !Array.isArray(obj) && Object.keys(parentObj).length) {
        parentObj[key] = [];
        obj = parentObj[key];
      }
      key = Number.isNaN(index) ? split[i] : index;

      if (Array.isArray(obj) && typeof key !== 'number') {
        console.warn('Array only allows inserting by index');
        return { obj, key: null };
      }
      if (i + 1 < length) {
        if (obj[key] == null)
          obj[key] = typeof key === 'number' ? [] : {};
        parentObj = obj;
        obj = obj[key];
      }
    }
    return { obj, key };
  }

  private static parseInnerXml(element: Element): GameObject {
    return null;
  }
}
