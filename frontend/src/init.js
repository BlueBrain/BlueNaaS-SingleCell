import {inject} from 'aurelia-framework';
import {UIDialogService} from 'aurelia-ui-framework';

@inject(UIDialogService)
export class Init {

    constructor(dlgSvc) {
        this.dlgSvc = dlgSvc;
    }
}
