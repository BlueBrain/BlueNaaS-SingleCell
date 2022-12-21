import {singleton, inject} from 'aurelia-framework';
import {ValidationRules} from 'aurelia-validation';
import {UIModel} from 'aurelia-ui-framework';


@singleton()
export class DataModel extends UIModel {
    _initialized = false;
    isFixedDt = false;
    celsius = 34;
    dt = null;
    tstop = 1000;
    delay = 100;
    dur = 800;
    amp = 0.7;
    hypamp = 0;
    vinit = -73;
    recordFrom = [];

    constructor() {
        super();
        ValidationRules
            .ensure(m => m.celsius)
            .required()
            .satisfiesRule('decimal', 20, 40)
            .ensure(m => m.tstop)
            .required()
            .satisfiesRule('decimal', 0, 3000)
            .ensure(m => m.delay)
            .required()
            .satisfiesRule('decimal', 0, 3000)
            .ensure(m => m.dur)
            .required()
            .satisfiesRule('decimal', 0, 3000)
            .ensure(m => m.amp)
            .required()
            .satisfiesRule('decimal', -10, 10)
            .ensure(m => m.hypamp)
            .required()
            .withMessage('Holding current is required')
            .satisfiesRule('decimal', -10, 10)
            .withMessage('Holding current must be a decimal value between -10 and 10.')
            .ensure(m => m.dt)
            .satisfies(v => this.isFixedDt ? 0 < v && v < 10 : v === null)
            .withMessage('fixed time step should be greater than 0 and less than 10ms')
            .ensure(m => m.vinit)
            .required()
            .satisfiesRule('decimal', -100, 100)
            .on(this);
    }
}

export function initDataModel(dataModel, params) {
    if (dataModel._initialized) {
        return;
    }
    if (params && !isNaN(params.hypamp)) {
        dataModel.hypamp = params.hypamp;
        dataModel._initialized = true;
    }
    if (params && !isNaN(params.dt)) {
        dataModel.isFixedDt = true;
        dataModel.dt = params.dt;
        dataModel._initialized = true;
    } else {
        dataModel.isFixedDt = false;
        dataModel.dt = null;
    }
    if (params && !isNaN(params.vinit)) {
        dataModel.vinit = params.vinit;
        dataModel._initialized = true;
    }
    if (params && !isNaN(params.tstop)) {
        dataModel.tstop = params.tstop;
        dataModel._initialized = true;
    }
    if (params && !isNaN(params.delay)) {
        dataModel.delay = params.delay;
        dataModel._initialized = true;
    }
    if (params && !isNaN(params.dur)) {
        dataModel.dur = params.dur;
        dataModel._initialized = true;
    }
    if (params && !isNaN(params.amp)) {
        dataModel.amp = params.amp;
        dataModel._initialized = true;
    }
    if (params && !isNaN(params.celsius)) {
        dataModel.celsius = params.celsius;
        dataModel._initialized = true;
    }
}
