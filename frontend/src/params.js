import {singleton, inject, computedFrom} from 'aurelia-framework';
import {EventAggregator} from 'aurelia-event-aggregator';
import {ValidationRules, ValidationControllerFactory, validateTrigger} from 'aurelia-validation';
import {saveAs} from 'file-saver';
import Dygraph from 'dygraphs';
import WebSocketSvc from 'web-socket-svc';
import {UIModel, UIUtils, UIEvent} from 'aurelia-ui-framework';
import html2canvas from 'html2canvas';
import {DataModel} from 'dataModel';

const startGlyph = 'si-bootstrap-play';
const stopGlyph  = 'si-bootstrap-stop';
const startLabel = 'Start simulation';
const stopLabel  = 'Stop simulation';

// add leading zero if num < 10
const pad = function(num) {
    return ('0' + num).slice(-2);
}

const legendFormatter = function(data) {
    let g = data.dygraph;

    if (g.getOption('showLabelsOnHighlight') !== true) return '';

    let sepLines = g.getOption('labelsSeparateLines');
    let html;

    if (typeof(data.x) === 'undefined') {
        if (g.getOption('legend') != 'always') {
            return '';
        }

        html = '';
        for (let i = 0; i < data.series.length; i++) {
            let series = data.series[i];
            if (!series.isVisible) continue;

            html += `<br/><span style='font-weight: bold; color: ${series.color};'>${series.labelHTML}</span>`;
        }
        return html;
    }

    html = 'time: ' + data.xHTML;
    for (var i = 0; i < data.series.length; i++) {
        var series = data.series[i];
        if (!series.isVisible || !series.y) continue;
        if (sepLines) html += '<br>';
        var cls = series.isHighlighted ? ' class="highlight"' : '';
        html += `<span${cls}> <b><span style='color: ${series.color};'>${series.labelHTML}</span></b>:&#160;${series.yHTML}</span>`;
    }
    return html;
}

function hsvToRGBA(hue, saturation, value, alpha) {
    var red;
    var green;
    var blue;
    if (saturation === 0) {
        red = value;
        green = value;
        blue = value;
    } else {
        var i = Math.floor(hue * 6);
        var f = hue * 6 - i;
        var p = value * (1 - saturation);
        var q = value * (1 - saturation * f);
        var t = value * (1 - saturation * (1 - f));
        switch (i) {
            case 1:
                red = q;green = value;blue = p;break;
            case 2:
                red = p;green = value;blue = t;break;
            case 3:
                red = p;green = q;blue = value;break;
            case 4:
                red = t;green = p;blue = value;break;
            case 5:
                red = value;green = p;blue = q;break;
            case 6: // fall through
            case 0:
                red = value;green = t;blue = p;break;
        }
    }
    red = Math.floor(255 * red + 0.5);
    green = Math.floor(255 * green + 0.5);
    blue = Math.floor(255 * blue + 0.5);
    return 'rgba(' + red + ',' + green + ',' + blue + ',' + alpha + ')';
}

@inject(EventAggregator, WebSocketSvc, ValidationControllerFactory, DataModel)
export class Params {
    _simulationTabActive = false;
    subscriptions = [];
    isSimRunning = false;
    isConnected = false;
    graphRef;
    legendRef;
    g;
    controller;
    model;
    segments = ['abc'];
    tags;
    tagsModel;
    _recordFrom = 'soma[0]_0';
    paramsCollapsed = false;
    simCtrlGlyph = startGlyph;
    simCtrlLabel = startLabel;
    simFileName;
    iclampSection;
    fixedTimestepPlaceholder = 'Variable time step';
    simCtrlBtnDisabled = false;
    uploaded = false;
    uploading = false;

    constructor(ea, ws, controllerFactory, dataModel) {
        this.ea = ea;
        this.ws = ws;
        this.controller = controllerFactory.createForCurrentScope();
        this.controller.validateTrigger = validateTrigger.changeOrBlur;
        this.model = dataModel;
        this.model.hypamp = 0;
        this.model.recordFrom = [this._recordFrom];
    }

    attached() {
        this.tagsModel.valueProperty = null;
        this.tagsModel.displayProperty = null;
        this.tagsModel.iconProperty = null;

        this.g = new Dygraph(
                this.graphRef,
                [[0, 0]],
                {
                    legend: 'always',
                    labelsDiv: this.legendRef,
                    legendFormatter: legendFormatter,
                    labelsSeparateLines: true,
                    labels: ['t', 'v'],
                    xlabel: 'time [ms]',
                    ylabel: 'voltage [mV]',
                    xLabelHeight: 14,
                    yLabelWidth: 14,
                    connectSeparatedPoints: true,
                    axes: {
                        x: {
                            valueFormatter: function(x) { return x.toFixed(2); },
                        },
                        y: {
                            valueFormatter: function(y) { return y.toFixed(2); },
                        }
                    },
                    highlightSeriesOpts: {
                        strokeWidth: 3,
                        strokeBorderWidth: 1,
                        highlightCircleSize: 5
                    },
                    highlightCallback: (evnt, x, points, row, seriesName) => {
                        this.ea.publish('seg:hovered', seriesName); // this will highlight the compartment
                        this.ea.publish('sim:gradient', x); // this will show voltage gradient on the cell
                    },
                    unhighlightCallback: () => {
                        this.ea.publish('seg:hovered', null);
                        this.ea.publish('sim:gradient', 0);
                    },
                    underlayCallback: (canvas, area, g) => {
                        g.hidden_ctx_.lineJoin = 'bevel';
                        g.canvas_ctx_.lineJoin = 'bevel';
                    }
                });

        this.subscriptions.push(this.ea.subscribe('sim:recordings', recordings => {
            this.isSimRunning = true;
            this.g.updateOptions({ file: recordings, labels: ['t'].concat(this._recordFrom.split(',')) });
        }));
        this.subscriptions.push(this.ea.subscribe('seg:all', allSegNames => {
            this.segments = allSegNames;
        }));
        this.subscriptions.push(this.ea.subscribe('seg:selected', (seg) => {
            if (this._simulationTabActive) {
                this.tagsModel.addValue(seg.sec + '_' + seg.idx);
            }
        }));
        this.subscriptions.push(this.ea.subscribe('tab:activated', (tab) => {
            if (tab == 'simulation') {
                this._simulationTabActive = true;
                this.g.resize();
            } else {
                this._simulationTabActive = false;
            }
        }));
        this.subscriptions.push(this.ea.subscribe('ws:open', () => {
            this.isConnected = true;
        }));
        this.subscriptions.push(this.ea.subscribe('ws:close', () => {
            this.isConnected = false;
        }));
        this.subscriptions.push(this.ea.subscribe('sim:done', data => {
            let labels = data.shift();
            UIEvent.queueTask(() => {
                let dataString = 'index,' + labels.join(',') + '\n'; // header
                data.forEach((d, idx) => {
                    dataString += idx + ',' + d.join(',') + '\n';
                });
                this.dataString = dataString;
                let t = new Date();
                if (this.ws.modelId) {
                    this.simFileName = `sim_${this.ws.modelId}_${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`
                                      + `_${pad(t.getHours())}-${pad(t.getMinutes())}-${pad(t.getSeconds())}_amp-${this.iclampSection}-${this.model.amp}nA.csv`;
                } else if (this.ws.url) {
                    this.simFileName = `sim_${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`
                                      + `_${pad(t.getHours())}-${pad(t.getMinutes())}-${pad(t.getSeconds())}_amp-${this.iclampSection}-${this.model.amp}nA.csv`;
                }
            });
            this.isSimRunning = false;
            this.simCtrlGlyph = startGlyph;
            this.simCtrlLabel = startLabel;
            let series = {};
            let num = labels.length - 1;
            let half = Math.ceil(num / 2);
            for (let i = 0; i < num; i++) {
                let label = labels[num - i];
                let countUnderscores = label.split('_').length - 1;
                let idx = i % 2 ? (half + (i + 1)/ 2) : Math.ceil((i + 1) / 2);
                let hue = (1.0 * idx / (1 + num));
                if (countUnderscores == 1) {
                    series[label] = {strokeWidth: 2.0, color: hsvToRGBA(hue, 1.0, 0.5, 1.0)};
                } else if (countUnderscores > 1) {
                    // experimental trace(contain more than one underscore in the name)
                    series[label] = {strokeWidth: 1.0, color: hsvToRGBA(hue, 1.0, 0.5, 0.3)};
                }
            }
            this.g.updateOptions({ file: data, labels: labels, series: series });
            this.simCtrlBtnDisabled = false;
        }));
        this.subscriptions.push(this.ea.subscribe('iclamp', sec => {
            this.iclampSection = sec.replace('[', '_').replace(']', '');
        }));
    }

    detached() {
        for (let subscription of this.subscriptions) {
            subscription.dispose();
        }
    }

    @computedFrom('_recordFrom')
    get recordFrom() {
        return this._recordFrom;
    }

    set recordFrom(value) {
        let vals = value.split(',');
        if (vals.length > 10) {
            this._recordFrom = vals.slice(0, 10).join(',');
            UIUtils.toast({title: 'Error', message: 'Too many recording sites, only the first 10 will be used', theme: 'danger', glyph: 'glyph-alert-error'});
        } else {
            this._recordFrom = value;
            this.ea.publish('sim:record', vals);
            this.model.recordFrom = vals;
        }
    }

    async fixedClicked() {
        let validationResult = await this.controller.validate();
        if (this.model.isFixedDt) {
            this.fixedTimestepPlaceholder = 'Enter fixed time step';
        } else {
            this.fixedTimestepPlaceholder = 'Variable time step';
            this.model.dt = null;
        }
    }

    async simCtrlBtnClick() {
        if (this.isConnected) {
            if (this.isSimRunning) {
                this.isSimRunning = false;
                this.simCtrlGlyph = startGlyph;
                this.simCtrlLabel = startLabel;
                this.ws.sendMessage('stop_simulation');
                this.simCtrlBtnDisabled = true;
            } else {
                let validationResult = await this.controller.validate();
                if (validationResult.valid) {
                    this.simFileName = null;
                    this.isSimRunning = true;
                    this.paramsCollapsed = true;
                    this.simCtrlGlyph = stopGlyph;
                    this.simCtrlLabel = stopLabel;
                    this.ws.sendMessage('start_simulation', {
                        celsius:    this.model.celsius,
                        tstop:      this.model.tstop,
                        delay:      this.model.delay,
                        dur:        this.model.dur,
                        amp:        this.model.amp,
                        hypamp:     this.model.hypamp,
                        dt:         this.model.dt,
                        vinit:      this.model.vinit,
                        recordFrom: this.model.recordFrom,
                    });
                    this.uploaded = false;
                }
            }
        }
    }

    simSaveBtnClick() {
        let blob = new Blob([this.dataString], {type: 'text/plain;charset=utf-8'});
        saveAs(blob, this.simFileName);
    }
}
