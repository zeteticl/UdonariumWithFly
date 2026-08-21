import { EventSystem, Network } from '../system';
import { BufferSharingTask } from './buffer-sharing-task';
import { FileReaderUtil } from './file-reader-util';
import { PdfFile, PdfFileContext, PdfState } from './pdf-file';
import { PdfCatalogItem, PdfStorage } from './pdf-storage';

export class PdfSharingSystem {
  private static _instance: PdfSharingSystem;
  static get instance(): PdfSharingSystem {
    if (!PdfSharingSystem._instance) PdfSharingSystem._instance = new PdfSharingSystem();
    return PdfSharingSystem._instance;
  }

  private sendTaskMap: Map<string, BufferSharingTask<PdfFileContext>> = new Map();
  private receiveTaskMap: Map<string, BufferSharingTask<PdfFileContext>> = new Map();
  private maxSendTask = 2;
  private maxReceiveTask = 4;

  private constructor() { }

  initialize() {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on('CONNECT_PEER', -1, event => {
        if (!event.isSendFromSelf) return;
        PdfStorage.instance.synchronize();
      })
      .on('SYNCHRONIZE_PDF_LIST', event => {
        if (event.isSendFromSelf) return;
        const otherCatalog: PdfCatalogItem[] = event.data;
        const request: PdfCatalogItem[] = [];
        for (const item of otherCatalog) {
          let pdf = PdfStorage.instance.get(item.identifier);
          if (pdf === null) {
            pdf = PdfFile.createEmpty(item.identifier);
            PdfStorage.instance.add(pdf);
          }
          if (pdf.state < PdfState.COMPLETE && !this.receiveTaskMap.has(item.identifier)) {
            request.push({ identifier: item.identifier, state: pdf.state });
          }
        }
        if (request.length < 1 && !this.hasActiveTask() && otherCatalog.length < PdfStorage.instance.getCatalog().length) {
          PdfStorage.instance.synchronize(event.sendFrom);
        }
        if (request.length < 1 || this.isLimitReceiveTask()) return;
        const index = Math.floor(Math.random() * request.length);
        this.request([request[index]], event.sendFrom);
      })
      .on('REQUEST_PDF_RESOURE', event => {
        if (event.isSendFromSelf) return;
        const request: PdfCatalogItem[] = event.data.identifiers;
        const randomRequest: PdfCatalogItem[] = [];
        for (const item of request) {
          const pdf = PdfStorage.instance.get(item.identifier);
          if (pdf && item.state < pdf.state) randomRequest.push({ identifier: item.identifier, state: item.state });
        }
        if (!this.isLimitSendTask() && randomRequest.length && !this.existsSendTask(event.data.receiver)) {
          const index = Math.floor(Math.random() * randomRequest.length);
          const item = randomRequest[index];
          const pdf = PdfStorage.instance.get(item.identifier);
          this.startSendTask(pdf, event.data.receiver);
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
      .on('UPDATE_PDF_RESOURE', 1000, event => {
        const updatePdfs: PdfFileContext[] = event.data;
        for (const context of updatePdfs) {
          if (context.blob) context.blob = new Blob([context.blob], { type: context.type || 'application/pdf' });
          PdfStorage.instance.add(context);
        }
      })
      .on('START_PDF_TRANSMISSION', event => {
        const identifier: string = event.data.fileIdentifier;
        const pdf = PdfStorage.instance.get(identifier);
        if (this.receiveTaskMap.has(identifier) || (pdf && PdfState.COMPLETE <= pdf.state)) {
          EventSystem.call('CANCEL_TASK_' + identifier, null, event.sendFrom);
        } else {
          this.startReceiveTask(identifier);
        }
      });
  }

  private async startSendTask(pdf: PdfFile, sendTo: string) {
    const task = BufferSharingTask.createSendTask<PdfFileContext>(pdf.identifier, sendTo);
    this.sendTaskMap.set(pdf.identifier, task);
    EventSystem.call('START_PDF_TRANSMISSION', { fileIdentifier: pdf.identifier }, sendTo);
    const context: PdfFileContext = {
      identifier: pdf.identifier,
      name: pdf.name,
      blob: null,
      type: '',
      url: null
    };
    if (pdf.state === PdfState.URL) {
      context.url = pdf.url;
    } else {
      context.blob = <any>await FileReaderUtil.readAsArrayBufferAsync(pdf.blob);
      context.type = pdf.blob.type || 'application/pdf';
    }
    task.onfinish = () => {
      this.stopSendTask(task.identifier);
      PdfStorage.instance.synchronize();
    };
    task.start(context);
  }

  private startReceiveTask(identifier: string) {
    const pdf = PdfStorage.instance.get(identifier);
    const task = BufferSharingTask.createReceiveTask<PdfFileContext>(identifier);
    this.receiveTaskMap.set(identifier, task);
    task.onprogress = (task, loaded, total) => {
      const context = pdf.toContext();
      context.name = (loaded * 100 / total).toFixed(1) + '%';
      pdf.apply(context);
    };
    task.onfinish = (task, data) => {
      this.stopReceiveTask(task.identifier);
      if (data) EventSystem.trigger('UPDATE_PDF_RESOURE', [data]);
      PdfStorage.instance.synchronize();
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

  private request(request: PdfCatalogItem[], peerId: string) {
    EventSystem.call('REQUEST_PDF_RESOURE', {
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
