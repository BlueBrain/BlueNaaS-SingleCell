import {inject} from 'aurelia-dependency-injection';
import {EventAggregator} from 'aurelia-event-aggregator';
import WebSocketSvc from 'web-socket-svc';


@inject(EventAggregator, WebSocketSvc)
export class SectionInfo {
    subscriptions = [];
    content = null;

    constructor(ea, ws) {
        this.ea = ea;
        this.ws = ws;
    }

    attached() {
        this.subscriptions.push(this.ea.subscribe('sec:selected', (data) => {
            // this will happen when tree element is selected
            this.ws.sendMessage('get_sec_info', data.id);
        }));
        this.subscriptions.push(this.ea.subscribe('seg:selected', (data) => {
            // this will happen when seGment is clicked in the viewport
            // this.ws.sendMessage('get_sec_info', data.sec);
        }));
        this.subscriptions.push(this.ea.subscribe('sec:unselected', () => {
            this.content = null;
        }));
        this.subscriptions.push(this.ea.subscribe('sec:info', data => {
            this.content = data.txt;
        }));
    }

    detached() {
        for (let subscription of this.subscriptions) {
            subscription.dispose();
        }
    }
}
