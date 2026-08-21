import { ImageFile } from './core/file-storage/image-file';
import { ObjectSerializer } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { ImageTag } from './image-tag';
import { ImageTagList } from './image-tag-list';

function destroyImageTags() {
  for (const tag of ObjectStore.instance.getObjects(ImageTag)) {
    try { tag.destroy(); } catch { /* ignore */ }
  }
  ObjectStore.instance.clearDeleteHistory();
}

function fakeImage(identifier: string): ImageFile {
  return { identifier } as ImageFile;
}

describe('ImageTag ZIP / backup round-trip', () => {
  beforeEach(() => destroyImageTags());
  afterEach(() => destroyImageTags());

  it('writes tag words and spoiler hide into fly_imageTag.xml', () => {
    const tagged = ImageTag.create('img_tagged');
    tagged.tag = 'boss map';
    tagged.hide = false;
    const hidden = ImageTag.create('img_hidden');
    hidden.hide = true;

    const xml = ImageTagList.create([fakeImage('img_tagged'), fakeImage('img_hidden')]).toXml();

    expect(xml).toContain('imageIdentifier="img_tagged"');
    expect(xml).toMatch(/tag="boss map"/);
    expect(xml).toContain('imageIdentifier="img_hidden"');
    expect(xml).toMatch(/hide="true"/);
  });

  it('restores tag words and spoiler hide after a fresh-store ZIP load', () => {
    const tagged = ImageTag.create('img_tagged');
    tagged.tag = 'boss map';
    const hidden = ImageTag.create('img_hidden');
    hidden.hide = true;

    const xml = ImageTagList.create([fakeImage('img_tagged'), fakeImage('img_hidden')]).toXml();

    destroyImageTags();
    expect(ImageTag.get('img_tagged')).toBeFalsy();
    expect(ImageTag.get('img_hidden')).toBeFalsy();

    const loaded = ObjectSerializer.instance.parseXml(xml);
    expect(loaded).toBeTruthy();

    const tagged2 = ImageTag.get('img_tagged');
    const hidden2 = ImageTag.get('img_hidden');
    expect(tagged2).toBeTruthy();
    expect(tagged2.tag).toBe('boss map');
    expect(tagged2.hide).toBeFalse();
    expect(hidden2).toBeTruthy();
    expect(hidden2.hide).toBeTrue();
    expect(hidden2.tag).toBe('');
  });

  it('includes tags whose images were not in the packed image list', () => {
    const extra = ImageTag.create('img_library_only');
    extra.tag = 'handout';
    extra.hide = true;

    const xml = ImageTagList.create([]).toXml();
    expect(xml).toContain('imageIdentifier="img_library_only"');
    expect(xml).toMatch(/tag="handout"/);
    expect(xml).toMatch(/hide="true"/);
  });

  it('merges into an existing tag when the same ZIP is loaded again', () => {
    const existing = ImageTag.create('img_tagged');
    existing.tag = 'old';
    existing.hide = false;

    const incoming = ImageTag.create('img_incoming');
    incoming.imageIdentifier = 'img_tagged';
    incoming.tag = 'newtag';
    incoming.hide = true;
    const xml = incoming.toXml();
    incoming.destroy();
    ObjectStore.instance.clearDeleted(incoming.identifier);

    ObjectSerializer.instance.parseXml(xml);

    const live = ImageTag.get('img_tagged');
    expect(live).toBe(existing);
    expect(live.tag).toBe('newtag');
    expect(live.hide).toBeTrue();
  });

  it('restores from legacy XML that has no syncId', () => {
    const xml = '<image-tag-list><image-tag imageIdentifier="img_legacy" tag="npc" hide="true"></image-tag></image-tag-list>';
    ObjectSerializer.instance.parseXml(xml);
    const tag = ImageTag.get('img_legacy');
    expect(tag).toBeTruthy();
    expect(tag.tag).toBe('npc');
    expect(tag.hide).toBeTrue();
  });
});
