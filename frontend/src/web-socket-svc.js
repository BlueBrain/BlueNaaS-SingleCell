import {singleton, inject} from 'aurelia-framework';
import {EventAggregator} from 'aurelia-event-aggregator';
import {UIApplication, UIConstants} from 'aurelia-ui-framework';
import {HttpClient} from 'aurelia-fetch-client';

import {DataModel, initDataModel} from 'dataModel';

const idleTimeout = 300000; // 5 min idle timeout

const maxRetryAttempts = 20;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let nextReconnetTimeout = 500;
let retryAttempt = 0;
let nextTimeout = () => {
    let timeout = Math.floor(Math.random() * nextReconnetTimeout);
    nextReconnetTimeout += 2;
    if (nextReconnetTimeout > 30000) { // max 30 sec retry
        nextReconnetTimeout = 30000;
    }
    return 2000 + timeout; // min wait 2 sec before reconnect
}

@singleton()
@inject(UIApplication, EventAggregator, DataModel)
export default class WebSocketSvc {
    ws;
    ea;
    modelId;
    isWebSocketError = false;
    connectionResolve;
    disconnected = false;
    idleFunc;
    wasOpended = false;

    constructor(app, ea, dataModel) {
        this.app = app;
        this.ea = ea;
        this.model = dataModel;
        this.init = new Promise(resolve => this.connectionResolve = resolve);
    }

    async connect(modelId) {
        this.disconnected = false;
        this.modelId = modelId;
        this.init = (async () => { await this.tryConnecting(); })();
        this.connectionResolve();
    }

    async connectUrl(url) {
        this.disconnected = false;
        this.url = url;
        this.init = (async () => { await this.tryConnecting(); })();
        this.connectionResolve();
    }

    async tryConnecting() {
        if (this.isWebSocketError) {
            return; // do not try connecting if explicitly error was received
        }
        this.ea.publish('connecting');
        await sleep(nextTimeout());
        try {
            await this.connectWebSocket();
        } catch (e) {
            retryAttempt += 1;
            this.app.error('init', e);
            if (!this.isWebSocketError) {
                if (retryAttempt < maxRetryAttempts) {
                    await this.tryConnecting();
                } else {
                    this.ea.publish('error', {msg: 'Unable to allocate NEURON instance. Please reload the page to retry.'});
                }
            }
        }
    }

    resetIdleTimeout() {
        if (this.idleFunc) {
            clearTimeout(this.idleFunc);
        }
        this.idleFunc = setTimeout(this.disconnect, idleTimeout);
    }

    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(WS_URL + '/ws');

            this.ws.onopen = () => {
                this.ea.publish('ws:open');
                this.wasOpended = true;
                this.resetIdleTimeout();
                resolve();
            };

            this.ws.onmessage = (e) => {
                this.resetIdleTimeout();
                let msg = JSON.parse(e.data);
                if (msg.cmd === 'morphology') {
                    this.ea.publish('morphology', msg.data);
                } else if (msg.cmd === 'topology') {
                    this.ea.publish('topology', msg.data);
                } else if (msg.cmd === 'dendrogram') {
                    this.ea.publish('dendrogram', msg.data);
                } else if (msg.cmd === 'synapses') {
                    this.ea.publish('synapses', msg.data);
                } else if (msg.cmd === 'iclamp') {
                    this.ea.publish('iclamp', msg.data);
                } else if (msg.cmd === 'model') {
                    this.ea.publish('model', msg.data);
                } else if (msg.cmd === 'error') {
                    this.isWebSocketError = true;
                    this.ea.publish('error', {msg: msg.data});
                } else if (msg.cmd === 'status') {
                    this.ea.publish('status', msg.data);
                } else if (msg.cmd === 'sim_done') {
                    this.ea.publish('sim:done', msg.data);
                } else if (msg.cmd === 'sim_voltage') {
                    this.ea.publish('sim:voltage', msg.data);
                } else if (msg.cmd === 'sec_info') {
                    this.ea.publish('sec:info', msg.data);
                } else if (msg.cmd === 'init_params') {
                    initDataModel(this.model, msg.data);
                }
            };

            this.ws.onclose = () => {
                if (this.idleFunc) {
                    clearTimeout(this.idleFunc);
                }

                if (!this.wasOpended) {
                    reject();
                }
                this.ea.publish('ws:close');
            };
        });
    }

    disconnect = (noMsg) => {
        this.disconnected = true;
        this.modelId = null;
        if (this.wasOpended) {
            this.ws.close();
            this.wasOpended = false;
        }
        if (noMsg) {
            this.ea.publish('disconnect', '');
        } else {
            this.ea.publish('disconnect', 'Disconnected. Please reload the page to reconnect.');
        }
    }

    async sendMessage(cmd, data) {
        if (this.disconnected) {
            throw 'Disconnected';
        }

        while (!this.ws || this.ws.readyState !== this.ws.OPEN) {
            await this.init;
        }
        this.ws.send(JSON.stringify({cmd: cmd, data: data}));
        this.resetIdleTimeout();
    }
}
