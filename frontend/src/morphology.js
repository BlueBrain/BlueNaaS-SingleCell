import {inject, computedFrom} from 'aurelia-framework';
import {EventAggregator} from 'aurelia-event-aggregator';
import {UITreeOptions, UIEvent, UIUtils} from 'aurelia-ui-framework';
import WebSocketSvc from 'web-socket-svc';

@inject(WebSocketSvc, EventAggregator)
export class Morphology {
    selectedSectionInfo = '';
    subscriptions = [];
    tree;
    treeModel = [];
    treeOpts = new UITreeOptions({
        showCheckbox: false,
        selectionLevel: -1,
    });
    _treeSelected = ''; // id of the node
    _treeSelectedLast = null; // tree node model, this is required to unselect the last tree item if selection changes
    _treeHovered = null;

    _enrichData(data, level) {
        for (let d of data) {
            d.text = d.id;
            d.expanded = true;
            d.level = level;
            d.extra = /^\w+/.exec(d.id)[0];
            d.icon = 'glyph-neurite-' + d.extra;
            if (d.children.length > 0) {
                this._enrichData(d.children, level + 1);
            } else {
                d.children = null;
            }
        }
    }

    /**
     * Apply function to each tree node
     */
    _forEachTreeNode(data, fn) {
        for (let d of data) {
            fn(d);
            if (d.children && d.children.length > 0) {
                this._forEachTreeNode(d.children, fn);
            }
        }
    }

    constructor(ws, ea) {
        this.ws = ws;
        this.ea = ea;
    }

    handleItemSelect = (evnt) => {
        if (evnt.detail) {
            evnt.detail.active = true;

            if (this._treeSelectedLast) {
                this._treeSelectedLast.active = false;
                this.ea.publish('sec:unselected', {id: this._treeSelectedLast.id});

                if (this._treeSelectedLast.id === evnt.detail.id) {
                    this._treeSelected = '';
                    this._treeSelectedLast = null;
                    return;
                }
            }
            this._treeSelectedLast = evnt.detail;
            this.ea.publish('sec:selected', {id: evnt.detail.id});
        }
    }

    attached() {
        this.subscriptions.push(this.ea.subscribe('locate:iclamp', (iclampSection) => {
            iclampSection = iclampSection.replace('[', '\\[');
            this.tree.searchText = iclampSection;
            this.tree.searchTextChanged(iclampSection);
        }));
        this.subscriptions.push(this.ea.subscribe('place:iclamp', () => {
            if (this._treeSelected) {
                this.ws.sendMessage('set_iclamp', this._treeSelected);
            } else {
                UIUtils.toast({message: 'Please select the section where to place the current injection', theme: 'warning', glyph: 'glyph-alert-question'});
            }
        }));
        this.subscriptions.push(this.ea.subscribe('iclamp', sec => {
            // server messag where iclamp is placed
            let model = this.treeModel;
            this._forEachTreeNode(model, (node) => {
                if (node.id == sec) {
                    node.text = node.id + ' IClamp(0.5)';
                    node.icon = 'glyph-iclamp-' + /^\w+/.exec(sec)[0];
                } else {
                    node.text = node.id;
                    node.icon = 'glyph-neurite-' + node.extra;
                }
            });
            this.treeModel = [{
                id:       model[0].id,
                text:     model[0].text,
                level:    model[0].level,
                icon:     model[0].icon,
                expanded: model[0].expanded,
                extra:    model[0].extra,
                children: model[0].children
            }];
        }));
        this.subscriptions.push(this.ea.subscribe('seg:selected', seg => {
            if (seg.sec) {
                this._treeSelected = seg.sec;
            }
        }));

        this.subscriptions.push(this.ea.subscribe('topology', data => {
            this.treeModel = data;
            this._enrichData(data, 0);
        }));

        this.treeRef.addEventListener('select', this.handleItemSelect);
    }

    detached() {
        for (let subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.treeRef.removeEventListener('select', this.handleItemSelect);
    }

    @computedFrom('_treeSelected')
    get treeSelected() {
        return this._treeSelected;
    }

    set treeSelected(value) {
        if (!value) { // if unselected -> value will be undefined
            this.ea.publish('sec:unselected', {id: this._treeSelected});
            this._treeSelected = '';
            this._treeSelectedLast = null;
        } else {
            this._treeSelected = value;
        }
    }

    @computedFrom('_treeHovered')
    get treeHovered() {
        return this._treeHovered;
    }

    set treeHovered(value) {
        this._treeHovered = value;
        this.ea.publish('sec:hovered', value);
    }
}
