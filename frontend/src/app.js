import {PLATFORM} from 'aurelia-pal';
import {inject, computedFrom} from 'aurelia-framework';
import {EventAggregator} from 'aurelia-event-aggregator';
import {UIApplication, UIConstants, UIDialogService, UIUtils} from 'aurelia-ui-framework';
import About from 'about';
import WebSocketSvc from 'web-socket-svc';


import '../styles/styles.css';


@inject(UIApplication, EventAggregator, WebSocketSvc, UIDialogService)
export class App {
    _tabActive = 0;
    _is3d = true;
    isConnected = false;
    isConnecting = false;
    isNeuronCollapsed = true;
    modelId = null;
    subscriptions = [];
    constants = UIConstants;
    toggle3dCtrl;
    toggle3dSwitch;
    currentPlaceDisabled = true;
    iclampSection = null;

    constructor(app, ea, ws, dlgSvc) {
        this.app = app;
        this.ea = ea;
        this.ws = ws;
        this.dlgSvc = dlgSvc;
    }

    configureRouter(config, router) {
        config.title = UIConstants.Title;
        config.map([
          {route: '',           name: 'init',  moduleId: PLATFORM.moduleName('init'),     nav: false},
          {route: 'model/*id',  name: 'model', moduleId: PLATFORM.moduleName('viewport'), nav: false,  href:'#model'},
          {route: 'url/*url',   name: 'url',   moduleId: PLATFORM.moduleName('viewport'), nav: false,  href:'#url'},
        ]);

        this.router = router;
    }

    attached() {
        this.subscriptions.push(this.ea.subscribe('connecting', () => {
            this.isConnecting = true;
        }));
        this.subscriptions.push(this.ea.subscribe('ws:open', () => {
            this._is3d = true;
            this.toggle3dCtrl.disabled = false;
            this.toggle3dSwitch.disabled = false;
            this.isConnecting = false;
            this.isConnected = true;
            this.isNeuronCollapsed = false;
            if (this.ws.modelId) {
              this.modelId = this.ws.modelId;
              this.ws.sendMessage('set_model', this.modelId);
            } else if (this.ws.url) {
              this.modelId = this.ws.url;
              this.ws.sendMessage('set_url', this.modelId);
            }
            this.ws.sendMessage('get_ui_data');
            UIUtils.toast({message: 'Loading model', theme: 'info', glyph: 'glyph-alert-info'});
        }));
        this.subscriptions.push(this.ea.subscribe('ws:close', () => {
            this.isConnected = false;
        }));
        this.subscriptions.push(this.ea.subscribe('error', (data) => {
            this.isConnecting = false;
            this.modelId = data.msg;
            UIUtils.toast({
                title: '<pre class="ui-font-small">NEURON: ' + data.msg + '</pre>',
                message: data.raw ? '<pre class="ui-font-small">' + data.raw + '</pre>': '',
                theme: 'danger',
                timeout: 10000,
                glyph: 'glyph-alert-error'
            });
            console.error(`${data.msg}:`, data.raw);
        }));
        this.subscriptions.push(this.ea.subscribe('disconnect', (text) => {
            this.isConnecting = false;
            this.modelId = text;
        }));
        this.subscriptions.push(this.ea.subscribe('status', (data) => {
            UIUtils.toast({
                title: '<pre class="ui-font-small">NEURON: ' + data.msg + '</pre>',
                message: data.raw ? '<pre class="ui-font-small">' + data.raw + '</pre>' : '',
                theme: 'dark',
                timeout: 10000,
                glyph: 'glyph-alert-exclaim'
            });
            console.log(`${data.msg}:`, data.raw);
        }));
        this.subscriptions.push(this.ea.subscribe('iclamp', sec => {
            // server messag where iclamp is placed
            this.iclampSection = sec;
        }));
        this.subscriptions.push(this.ea.subscribe('sec:selected', () => {
            this.currentPlaceDisabled = false;
        }));
        this.subscriptions.push(this.ea.subscribe('sec:unselected', () => {
            this.currentPlaceDisabled = true;
        }));
    }

    detached() {
        for (let subscription of this.subscriptions) {
            subscription.dispose();
        }
    }

    @computedFrom('_tabActive')
    get tabActive() {
        return this._tabActive;
    }

    set tabActive(value) {
        this.ea.publish('tab:activated', value);
        this._tabActive = value;
    }

    @computedFrom('_is3d')
    get is3d() {
        return this._is3d;
    }

    set is3d(value) {
        this._is3d = value;
        this.toggle3dCtrl.disabled = true;
        this.toggle3dSwitch.disabled = true;
        setTimeout(() => { this.toggle3dCtrl.disabled = false; this.toggle3dSwitch.disabled = false; }, 3000);

        if (this._is3d) {
            this.ea.publish('view:3d');
        } else {
            this.ea.publish('view:dendrogram');
        }
    }

    showAbout() {
        this.dlgSvc.show(About);
    }

    placeCurrentInjection() {
        this.ea.publish('place:iclamp');
    }

    locateIClamp() {
        this.ea.publish('locate:iclamp', this.iclampSection);
    }
}
