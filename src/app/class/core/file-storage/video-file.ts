import { FileReaderUtil } from './file-reader-util';

export enum VideoState {
  NULL = 0,
  COMPLETE = 2,
  URL = 1000,
}

export interface VideoFileContext {
  identifier: string;
  name: string;
  type: string;
  blob: Blob;
  url: string;
}

export class VideoFile {
  private context: VideoFileContext = {
    identifier: '',
    name: '',
    blob: null,
    type: '',
    url: ''
  };

  get identifier(): string { return this.context.identifier; }
  get name(): string { return this.context.name; }
  get blob(): Blob { return this.context.blob; }
  get url(): string { return this.context.url; }
  get type(): string { return this.context.type; }
  get state(): VideoState {
    if (!this.url && !this.blob) return VideoState.NULL;
    if (this.url && !this.blob) return VideoState.URL;
    return VideoState.COMPLETE;
  }

  private constructor() { }

  static createEmpty(identifier: string): VideoFile {
    const video = new VideoFile();
    video.context.identifier = identifier;
    return video;
  }

  static create(url: string): VideoFile
  static create(context: VideoFileContext): VideoFile
  static create(arg: any): VideoFile {
    if (typeof arg === 'string') {
      const video = new VideoFile();
      video.context.identifier = arg;
      video.context.name = arg;
      video.context.url = arg;
      return video;
    }
    const video = new VideoFile();
    video.apply(arg);
    return video;
  }

  static async createAsync(file: File, displayName?: string): Promise<VideoFile>
  static async createAsync(blob: Blob, displayName?: string): Promise<VideoFile>
  static async createAsync(arg: any, displayName?: string): Promise<VideoFile> {
    if (arg instanceof File) {
      return VideoFile._createAsync(arg, displayName != null ? displayName : arg.name);
    }
    if (arg instanceof Blob) {
      return VideoFile._createAsync(arg, displayName);
    }
  }

  private static async _createAsync(blob: Blob, name?: string): Promise<VideoFile> {
    const arrayBuffer = await FileReaderUtil.readAsArrayBufferAsync(blob);
    const video = new VideoFile();
    video.context.identifier = await FileReaderUtil.calcSHA256Async(arrayBuffer);
    let display = (name || '').trim();
    if (display && /\.[a-z0-9]{1,8}$/i.test(display)) {
      display = display.replace(/\.[^.]+$/, '') || display;
    }
    video.context.name = display;
    const mime = blob.type || 'video/mp4';
    video.context.blob = new Blob([arrayBuffer], { type: mime });
    video.context.type = video.context.blob.type;
    video.context.url = window.URL.createObjectURL(video.context.blob);
    if (!video.context.name) video.context.name = video.context.identifier;
    return video;
  }

  destroy() {
    if (this.state !== VideoState.URL && this.context.url) {
      window.URL.revokeObjectURL(this.context.url);
    }
  }

  apply(context: VideoFileContext) {
    if (!this.context.identifier && context.identifier) this.context.identifier = context.identifier;
    if (!this.context.name && context.name) this.context.name = context.name;
    if (!this.context.blob && context.blob) this.context.blob = context.blob;
    if (!this.context.type && context.type) this.context.type = context.type;
    if (!this.context.url && context.url) this.context.url = context.url;
    if (this.state !== VideoState.URL && this.context.blob && !this.context.url) {
      this.context.url = window.URL.createObjectURL(this.context.blob);
    }
  }

  toContext(): VideoFileContext {
    return {
      identifier: this.context.identifier,
      name: this.context.name,
      blob: this.context.blob,
      type: this.context.type,
      url: this.context.url
    };
  }
}
