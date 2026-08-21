import { EventSystem } from '../system';
import { ResettableTimeout } from '../system/util/resettable-timeout';
import { VideoFile, VideoFileContext, VideoState } from './video-file';

export type VideoCatalogItem = { readonly identifier: string, readonly state: number };

export class VideoStorage {
  private static _instance: VideoStorage;
  static get instance(): VideoStorage {
    if (!VideoStorage._instance) VideoStorage._instance = new VideoStorage();
    return VideoStorage._instance;
  }

  private lazyTimer: ResettableTimeout;
  private hash: { [identifier: string]: VideoFile } = {};

  get videos(): VideoFile[] {
    return Object.keys(this.hash).map(id => this.hash[id]);
  }

  private constructor() {
  }

  async addAsync(file: File, displayName?: string): Promise<VideoFile>
  async addAsync(blob: Blob, displayName?: string): Promise<VideoFile>
  async addAsync(arg: any, displayName?: string): Promise<VideoFile> {
    const video = await VideoFile.createAsync(arg, displayName);
    return this._add(video);
  }

  add(url: string): VideoFile
  add(video: VideoFile): VideoFile
  add(context: VideoFileContext): VideoFile
  add(arg: any): VideoFile {
    let video: VideoFile;
    if (typeof arg === 'string') {
      video = VideoFile.create(arg);
    } else if (arg instanceof VideoFile) {
      video = arg;
    } else {
      if (this.update(arg)) return this.hash[arg.identifier];
      video = VideoFile.create(arg);
    }
    return this._add(video);
  }

  private _add(video: VideoFile): VideoFile {
    if (VideoState.COMPLETE <= video.state) this.lazySynchronize(100);
    if (this.update(video)) return this.hash[video.identifier];
    this.hash[video.identifier] = video;
    return video;
  }

  private update(video: VideoFile): boolean
  private update(video: VideoFileContext): boolean
  private update(video: any): boolean {
    const updateVideo = this.hash[video.identifier];
    if (updateVideo) {
      updateVideo.apply(video instanceof VideoFile ? video.toContext() : video);
      return true;
    }
    return false;
  }

  delete(identifier: string): boolean {
    const video = this.hash[identifier];
    if (!video) return false;
    video.destroy();
    delete this.hash[identifier];
    return true;
  }

  get(identifier: string): VideoFile {
    return this.hash[identifier] || null;
  }

  synchronize(peer?: string) {
    if (this.lazyTimer) this.lazyTimer.stop();
    EventSystem.call('SYNCHRONIZE_VIDEO_LIST', this.getCatalog(), peer);
  }

  lazySynchronize(ms: number, peer?: string) {
    if (this.lazyTimer == null) this.lazyTimer = new ResettableTimeout(() => this.synchronize(peer), ms);
    this.lazyTimer.reset(ms);
  }

  getCatalog(): VideoCatalogItem[] {
    const catalog: VideoCatalogItem[] = [];
    for (const video of this.videos) {
      if (VideoState.COMPLETE <= video.state) {
        catalog.push({ identifier: video.identifier, state: video.state });
      }
    }
    return catalog;
  }
}
