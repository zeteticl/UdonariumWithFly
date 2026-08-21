import { EventSystem, Network } from '../system';
import { BufferSharingTask } from './buffer-sharing-task';
import { FileReaderUtil } from './file-reader-util';
import { VideoFile, VideoFileContext, VideoState } from './video-file';
import { VideoCatalogItem, VideoStorage } from './video-storage';

export class VideoSharingSystem {
  private static _instance: VideoSharingSystem;
  static get instance(): VideoSharingSystem {
    if (!VideoSharingSystem._instance) VideoSharingSystem._instance = new VideoSharingSystem();
    return VideoSharingSystem._instance;
  }

  private sendTaskMap: Map<string, BufferSharingTask<VideoFileContext>> = new Map();
  private receiveTaskMap: Map<string, BufferSharingTask<VideoFileContext>> = new Map();
  private maxSendTask = 2;
  private maxReceiveTask = 4;

  private constructor() { }

  initialize() {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on('CONNECT_PEER', -1, event => {
        if (!event.isSendFromSelf) return;
        VideoStorage.instance.synchronize();
      })
      .on('SYNCHRONIZE_VIDEO_LIST', event => {
        if (event.isSendFromSelf) return;
        const otherCatalog: VideoCatalogItem[] = event.data;
        const request: VideoCatalogItem[] = [];
        for (const item of otherCatalog) {
          let video = VideoStorage.instance.get(item.identifier);
          if (video === null) {
            video = VideoFile.createEmpty(item.identifier);
            VideoStorage.instance.add(video);
          }
          if (video.state < VideoState.COMPLETE && !this.receiveTaskMap.has(item.identifier)) {
            request.push({ identifier: item.identifier, state: video.state });
          }
        }
        if (request.length < 1 && !this.hasActiveTask() && otherCatalog.length < VideoStorage.instance.getCatalog().length) {
          VideoStorage.instance.synchronize(event.sendFrom);
        }
        if (request.length < 1 || this.isLimitReceiveTask()) return;
        const index = Math.floor(Math.random() * request.length);
        this.request([request[index]], event.sendFrom);
      })
      .on('REQUEST_VIDEO_RESOURE', event => {
        if (event.isSendFromSelf) return;
        const request: VideoCatalogItem[] = event.data.identifiers;
        const randomRequest: VideoCatalogItem[] = [];
        for (const item of request) {
          const video = VideoStorage.instance.get(item.identifier);
          if (video && item.state < video.state) randomRequest.push({ identifier: item.identifier, state: item.state });
        }
        if (!this.isLimitSendTask() && randomRequest.length && !this.existsSendTask(event.data.receiver)) {
          const index = Math.floor(Math.random() * randomRequest.length);
          const item = randomRequest[index];
          const video = VideoStorage.instance.get(item.identifier);
          this.startSendTask(video, event.data.receiver);
        } else {
          const candidatePeers: string[] = event.data.candidatePeers;
          const index = candidatePeers.indexOf(Network.peerId);
          if (-1 < index) candidatePeers.splice(index, 1);
          for (const peerId of candidatePeers) {
            EventSystem.call(event, peerId);
            return;
          }
        }
      })
      .on('UPDATE_VIDEO_RESOURE', 1000, event => {
        const updateVideos: VideoFileContext[] = event.data;
        for (const context of updateVideos) {
          if (context.blob) context.blob = new Blob([context.blob], { type: context.type || 'video/mp4' });
          VideoStorage.instance.add(context);
        }
      })
      .on('START_VIDEO_TRANSMISSION', event => {
        const identifier: string = event.data.fileIdentifier;
        const video = VideoStorage.instance.get(identifier);
        if (this.receiveTaskMap.has(identifier) || (video && VideoState.COMPLETE <= video.state)) {
          EventSystem.call('CANCEL_TASK_' + identifier, null, event.sendFrom);
        } else {
          this.startReceiveTask(identifier);
        }
      });
  }

  private async startSendTask(video: VideoFile, sendTo: string) {
    const task = BufferSharingTask.createSendTask<VideoFileContext>(video.identifier, sendTo);
    this.sendTaskMap.set(video.identifier, task);
    EventSystem.call('START_VIDEO_TRANSMISSION', { fileIdentifier: video.identifier }, sendTo);
    const context: VideoFileContext = {
      identifier: video.identifier,
      name: video.name,
      blob: null,
      type: '',
      url: null
    };
    if (video.state === VideoState.URL) {
      context.url = video.url;
    } else {
      context.blob = <any>await FileReaderUtil.readAsArrayBufferAsync(video.blob);
      context.type = video.blob.type || 'video/mp4';
    }
    task.onfinish = () => {
      this.stopSendTask(task.identifier);
      VideoStorage.instance.synchronize();
    };
    task.start(context);
  }

  private startReceiveTask(identifier: string) {
    const video = VideoStorage.instance.get(identifier);
    const task = BufferSharingTask.createReceiveTask<VideoFileContext>(identifier);
    this.receiveTaskMap.set(identifier, task);
    task.onprogress = (task, loaded, total) => {
      const context = video.toContext();
      context.name = (loaded * 100 / total).toFixed(1) + '%';
      video.apply(context);
    };
    task.onfinish = (task, data) => {
      this.stopReceiveTask(task.identifier);
      if (data) EventSystem.trigger('UPDATE_VIDEO_RESOURE', [data]);
      VideoStorage.instance.synchronize();
    };
    task.start();
  }

  private stopSendTask(identifier: string) {
    const task = this.sendTaskMap.get(identifier);
    if (task) task.cancel();
    this.sendTaskMap.delete(identifier);
  }

  private stopReceiveTask(identifier: string) {
    const task = this.receiveTaskMap.get(identifier);
    if (task) task.cancel();
    this.receiveTaskMap.delete(identifier);
  }

  private request(request: VideoCatalogItem[], peerId: string) {
    EventSystem.call('REQUEST_VIDEO_RESOURE', {
      identifiers: request,
      receiver: Network.peerId,
      candidatePeers: Network.peerIds
    }, peerId);
  }

  private hasActiveTask(): boolean {
    return 0 < this.sendTaskMap.size || 0 < this.receiveTaskMap.size;
  }

  private isLimitSendTask(): boolean {
    return this.maxSendTask <= this.sendTaskMap.size;
  }

  private isLimitReceiveTask(): boolean {
    return this.maxReceiveTask <= this.receiveTaskMap.size;
  }

  private existsSendTask(peerId: string): boolean {
    for (const task of this.sendTaskMap.values()) {
      if (task && task.sendTo === peerId) return true;
    }
    return false;
  }
}
