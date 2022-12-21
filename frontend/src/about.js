import {UIDialog, UIConstants} from 'aurelia-ui-framework';

export default class About extends UIDialog {
    modal = true;
    title = 'About Neuron as a Service';
    draggable = false;
    resizable = false;
    minimizable = false;
    maximizable = false;
    constants = UIConstants;

    constructor() {
        super();
    }
}
