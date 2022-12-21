import { PLATFORM } from 'aurelia-pal';
import 'font-awesome/css/font-awesome.css';
import 'dygraphs/dist/dygraph.css';
// import 'bootstrap/dist/css/bootstrap.css';
// import 'bootstrap';
import {UIConstants} from 'aurelia-ui-framework';
import '@babel/polyfill';

export async function configure(aurelia) {
    UIConstants.AppKey        = APP_KEY;
    UIConstants.Title         = TITLE;
    UIConstants.Version       = VERSION;
    UIConstants.NeuronVersion = NEURON_VERSION;

    aurelia.use
        .standardConfiguration()
        .plugin(PLATFORM.moduleName('aurelia-animator-css'))
        .plugin(PLATFORM.moduleName('aurelia-validation'))
        .plugin(PLATFORM.moduleName('aurelia-ui-virtualization'))
        .plugin(PLATFORM.moduleName('aurelia-ui-framework'))
        .plugin(PLATFORM.moduleName('about'));

    if (PRODUCTION) {
        ga('send', 'pageview', '/blue/naas');
    } else {
        aurelia.use.developmentLogging();
    }

    await aurelia.start();
    await aurelia.setRoot(PLATFORM.moduleName('app'));
}
