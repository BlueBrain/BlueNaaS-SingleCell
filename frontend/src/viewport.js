import {inject} from 'aurelia-framework';
import {EventAggregator} from 'aurelia-event-aggregator';
import {UIApplication, UIUtils} from 'aurelia-ui-framework';
import {Scene, Object3D, Quaternion, Matrix4, PerspectiveCamera, OrthographicCamera, DirectionalLight, DoubleSide, Raycaster, Color, MathUtils as Mth,
        BufferGeometry, BoxGeometry, MeshLambertMaterial, CylinderGeometry, LineBasicMaterial, Line, BoxHelper, Group, LineSegments, ConeGeometry,
        Mesh, WebGLRenderer, Points, PointsMaterial, Vector2, Vector3, BufferAttribute} from 'three';
import {TrackballControls} from 'three/examples/jsm/controls/TrackballControls';
import {Tween, update as TweenUpdate} from '@tweenjs/tween.js';
import Dygraph from 'dygraphs';

import WebSocketSvc from 'web-socket-svc';
import {DataModel, initDataModel} from 'dataModel';

const soma_color = 0x646464;
const axon_color = 0x4169ff;
const dend_color = 0xdc143c;
const apic_color = 0x960096;
const spine_color = 0xff9900;
const spike_color = 0xffdf00;
const exc_color = 0xff0000;
const inh_color = 0x6699ff;

const frustumSize = 670;
const padSegment = 2
const padBranch = 4

const padding = 2;

const tweenInterval = 2000;

let voltageMin;
let voltageMax;

let secNSegs = [];
let secNames = [];

let simulation = [];
let recordings = [];
let recordFrom = 'soma[0]_0';

let getColor = (name) => {
    let color = 0x888888;
    if (/^soma/.test(name)) {
        color = soma_color;
    } else if (/^axon/.test(name)) {
        color = axon_color;
    } else if (/^dend/.test(name)) {
        color = dend_color;
    } else if (/^apic/.test(name)) {
        color = apic_color;
    } else if (/^spine/.test(name)) {
        color = spine_color;
    } else if (/^exc/.test(name)) {
        color = exc_color;
    } else if (/^inh/.test(name)) {
        color = inh_color;
    }
    return color;
}

@inject(UIApplication, EventAggregator, WebSocketSvc, DataModel)
export class Viewport {
    ws;
    runAnimation = false;
    camera;
    light = new DirectionalLight(0xffffff);
    scene = new Scene();
    renderer;
    viewportRef;
    canvasRef;
    height;
    width;
    geometry;
    subscriptions = [];
    content = '';
    group = new Group();
    data;
    box = new BoxHelper(undefined, spike_color);
    secHovered = null;
    segHoveredIdx = null;
    dendrogram;
    synapses;
    dendrogramLines;
    isSimulationRunning = false;

    raycaster = new Raycaster();

    // -----
    // |   |
    // |   |
    // |   |
    // |   |
    // l-x-- base
    // x = baseCenterX
    // l = left
    _dendroTween(sec, left, base, dendrogramLines) {
        let childSecCount = sec.sections.length;
        let baseCenterX = left + sec.total_width / 2;
        let bottom = base;

        sec.segments.forEach((seg, idx) => {
            let segName = sec.name + '_' + idx;
            let segCylinderMesh = this.group.getObjectByName(segName);

            new Tween(segCylinderMesh.scale)
                .to({y: 1}, tweenInterval)
                .start();

            let quatFrom = segCylinderMesh.quaternion.clone(), quatTo = new Quaternion();
            new Tween({t: 0})
                .to({t: 1}, tweenInterval)
                .onUpdate(param => segCylinderMesh.quaternion.slerpQuaternions(quatFrom, quatTo, param.t))
                .start();

            new Tween(segCylinderMesh.position)
                .to({x: baseCenterX, y: bottom + seg.length / 2, z: 0}, tweenInterval)
                .start();

            let distance = this.data[sec.name].distance[idx];
            for (let synapseMesh of segCylinderMesh.children) {
                let randomDir = Mth.randInt(0, 1) ? -1 : 1;
                let randomPos = Mth.randFloatSpread(seg.length / 2);
                new Tween(synapseMesh.position)
                    .to({x: randomDir * seg.diam / 2, y: randomPos, z: 0}, tweenInterval)
                    .start();

                let quatFrom = synapseMesh.quaternion.clone(), quatTo = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), new Vector3(0, randomDir, 0));
                new Tween({t: 0})
                    .to({t: 1}, tweenInterval)
                    .onUpdate(param => synapseMesh.quaternion.slerpQuaternions(quatFrom, quatTo, param.t))
                    .start();
            }

            bottom += padding + seg.length; // next segment base is above current
        });

        let childSecXOffSet = 0;
        for (let childSec of sec.sections) {
            // add lines connecting sections
            let childBaseCenterX = left + childSecXOffSet + childSec.total_width / 2;
            dendrogramLines.push(baseCenterX,      base + sec.height - padding, 0); // height includes padding
            dendrogramLines.push(childBaseCenterX, base + sec.height,           0);

            this._dendroTween(childSec, left + childSecXOffSet, base + sec.height, dendrogramLines);
            childSecXOffSet += childSec.total_width;
        }
    }

    _3dTween(sec) {
        let secData = this.data[sec.name];
        sec.segments.forEach((seg, idx) => {
            let segName = sec.name + '_' + idx;
            let segCylinderMesh = this.group.getObjectByName(segName);

            let length = secData.length[idx];
            let diam = secData.diam[idx];
            let distance = secData.distance[idx];
            let scaleLength = distance / length;

            new Tween(segCylinderMesh.scale)
                .to({y: scaleLength}, tweenInterval)
                .start();

            let quatFrom = segCylinderMesh.quaternion.clone();
            let axis = new Vector3(secData.xdirection[idx], secData.ydirection[idx], secData.zdirection[idx]);
            axis.normalize();
            let quatTo = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);

            new Tween({t: 0}).to({t: 1}, tweenInterval)
                .onUpdate(param => segCylinderMesh.quaternion.slerpQuaternions(quatFrom, quatTo, param.t))
                .start();

            let v = new Vector3(secData.xcenter[idx], secData.ycenter[idx], secData.zcenter[idx]);

            new Tween(segCylinderMesh.position)
                .to({x: v.x, y: v.y, z: v.z}, tweenInterval)
                .start();

            for (let synapseMesh of segCylinderMesh.children) {
                let pos = new Vector3(), scale = new Vector3();
                let quatFrom = synapseMesh.quaternion.clone();
                let axis = new Vector3(0, 1, 0);
                let random = new Vector3(Mth.randFloatSpread(2), Mth.randFloatSpread(2), Mth.randFloatSpread(2));
                let offset = Mth.randFloatSpread(length);
                let m = new Matrix4().makeTranslation(0, -diam/2 - synapseMesh.geometry.parameters.height/3, 0);
                axis.cross(random).normalize();
                let q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);
                m = new Matrix4().makeRotationFromQuaternion(q).multiply(m);
                m = new Matrix4().makeTranslation(0, offset, 0).multiply(m);
                m.decompose(pos, q, scale);

                new Tween(synapseMesh.position)
                    .to({x: pos.x, y: pos.y, z: pos.z}, tweenInterval)
                    .start();

                new Tween({t: 0})
                    .to({t: 1}, tweenInterval)
                    .onUpdate(param => synapseMesh.quaternion.slerpQuaternions(quatFrom, q, param.t))
                    .start();
            }
        });

        for (let childSec of sec.sections) {
            this._3dTween(childSec);
        }
    }

    constructor(app, ea, ws, dataModel) {
        this.app = app;
        this.ea = ea;
        this.ws = ws;
        this.box.material.linewidth = 3;
        this.model = dataModel;
    }

    set3dView() {
        this.camera = new PerspectiveCamera(70, this.viewportRef.clientWidth / this.viewportRef.clientHeight, 1, 10000);
        this.camera.position.setZ(-500);
        this.camera.lookAt(new Vector3());

        this.controls = new TrackballControls(this.camera, this.canvasRef);
        this.controls.addEventListener('change', this.updateLightPosition);

        this.updateLightPosition();
    }

    set2dView() {
        let aspect = this.viewportRef.clientWidth / this.viewportRef.clientHeight;
        this.camera = new OrthographicCamera(-frustumSize * aspect / 2, frustumSize * aspect / 2, frustumSize / 2, -frustumSize / 2, 1, 10000);

        this.camera.position.setZ(-500);
        this.camera.lookAt(new Vector3());

        this.controls.removeEventListener('change', this.updateLightPosition);
        this.controls = new TrackballControls(this.camera, this.canvasRef);
        this.controls.zoomSpeed = -0.1;
        this.controls.noRoll = true;
        this.controls.noRotate = true;
        this.controls.addEventListener('change', this.updateLightPosition);
    }

    init() {
        this.scene.add(this.box);
        this.box.visible = false;
        this.scene.add(this.light);
        this.set3dView();
        this.canvasRef.addEventListener('mousemove', this.onMouseMove);
    }

    attached() {
        this.renderer = new WebGLRenderer({ canvas: this.canvasRef, antialias: true, alpha: true });
        this.runAnimation = true;
        this.init();
        this.animate();

        this.subscriptions.push(this.ea.subscribe('ws:open', () => {
            this.scene.remove(this.group);
            this.group = new Group();
            this.scene.remove(this.dendrogramLines);
            this.dendrogramLines = null;
            this.isSimulationRunning = false;
            this.set3dView();
        }));
        this.subscriptions.push(this.ea.subscribe('view:3d', sec_name => {
            this.controls.enabled = false;

            this.scene.remove(this.dendrogramLines);
            this.dendrogramLines = null;

            new Tween(this.controls.target)
                .to({x: 0, y: 0, z: 0}, tweenInterval)
                .start();

            new Tween(this.camera)
                .to({zoom: 1}, tweenInterval)
                .onUpdate(cam => cam.updateProjectionMatrix())
                .start();

            new Tween(this.controls.object.position)
                .to({x: this.controls.position0.x, y: this.controls.position0.y, z: this.controls.position0.z}, tweenInterval)
                .onUpdate(() => this.updateLightPosition())
                .start();

            new Tween({time: 0})
                .to({time: tweenInterval}, tweenInterval)
                .onComplete(() => this.set3dView())
                .start();

            this._3dTween(this.dendrogram);
        }));

        this.subscriptions.push(this.ea.subscribe('view:dendrogram', sec_name => {
            this.controls.enabled = false;

            new Tween(this.controls.target)
                .to({x: 0, y: 0, z: 0}, tweenInterval)
                .start();

            new Tween(this.controls.object.position)
                .to({x: this.controls.position0.x, y: this.controls.position0.y, z: this.controls.position0.z}, tweenInterval)
                .start();

            new Tween(this.controls.object.up)
                .to({x: this.controls.up0.x, y: this.controls.up0.y, z: this.controls.up0.z}, tweenInterval)
                .onUpdate(() => this.updateLightPosition())
                .start();

            let dendrogramLines = []
            new Tween({time: 0})
                .to({time: 2000}, tweenInterval)
                .onComplete(() => {
                    this.set2dView();
                    let lineGeometry = new BufferGeometry();
                    lineGeometry.setAttribute('position', new BufferAttribute(new Float32Array(dendrogramLines), 3));
                    this.dendrogramLines = new LineSegments(lineGeometry, new LineBasicMaterial({color: 0x000000}));
                    this.scene.add(this.dendrogramLines);
                }).start();


            this._dendroTween(this.dendrogram, -this.dendrogram.total_width / 2, -300, dendrogramLines);
        }));

        this.subscriptions.push(this.ea.subscribe('seg:hovered', segName => {
            if (segName) {
                let [sec_name, seg_idx_name] = segName.split('_');
                if (!sec_name || !seg_idx_name) {
                    this.box.visible = false;
                    return; // ignore bad seg names(happens when initialized with 'v' label)
                }
                let seg_idx = parseInt(seg_idx_name);
                let sec = this.data[sec_name];

                if (!sec || seg_idx == NaN) {
                    this.box.visible = false;
                    return; // ignore if experimental traces with free form name were provided
                }

                segName = sec_name + '_' + seg_idx_name;
                let length = this.dendrogramLines ? sec.length[seg_idx] : sec.distance[seg_idx];
                this.box.setFromObject(new Mesh(new BoxGeometry(sec.diam[seg_idx], length, sec.diam[seg_idx], 2, 2, 2)));
                let segCylinderMesh = this.group.getObjectByName(segName);
                if (!segCylinderMesh) {
                    this.box.visible = false;
                    return; // ignore if segName was incorrectly constructed(might happen for free form experimental traces)
                }
                this.box.setRotationFromQuaternion(segCylinderMesh.quaternion);
                this.box.position.copy(segCylinderMesh.position);
                this.box.updateMatrix();

                this.box.visible = true;
            } else {
                this.box.visible = false;
            }
        }));

        this.subscriptions.push(this.ea.subscribe('sec:hovered', secName => {
            if (secName) {
                let segName = secName + '_0'; // hover the first segment of the section
                this.ea.publish('seg:hovered', segName);
            } else {
                this.box.visible = false;
            }
        }));

        this.subscriptions.push(this.ea.subscribe('dendrogram', dendrogram => {
            this.dendrogram = dendrogram;
        }));

        this.subscriptions.push(this.ea.subscribe('synapses', synapses => {
            this.synapses = synapses;

            for (let syn_type in this.synapses) {
                for (let {sec_name, seg_idx} of this.synapses[syn_type]) {
                    let sec = this.data[sec_name];
                    let axis = new Vector3(0, 1, 0);
                    let random = new Vector3(Mth.randFloatSpread(2), Mth.randFloatSpread(2), Mth.randFloatSpread(2));
                    let height = Mth.randFloat(0.5, 1.2);
                    let radius = Mth.randFloat(0.25, height / 2);
                    let offset = Mth.randFloatSpread(sec.length[seg_idx]);
                    let mesh = new Mesh(new ConeGeometry(radius, height, 6),
                                        new MeshLambertMaterial({color: getColor(syn_type), side: DoubleSide}));
                    let m = new Matrix4().makeTranslation(0, -sec.diam[seg_idx]/2 - height/3, 0);
                    axis.cross(random).normalize();
                    let q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);
                    m = new Matrix4().makeRotationFromQuaternion(q).multiply(m);
                    m = new Matrix4().makeTranslation(0, offset, 0).multiply(m);
                    mesh.applyMatrix(m);
                    let segCylinderMesh = this.group.getObjectByName(sec_name + '_' + seg_idx);
                    segCylinderMesh.add(mesh);
                }
            }
        }));

        this.subscriptions.push(this.ea.subscribe('morphology', data => {
            let allSegNames = [];

            this.data = data;

            this.scene.remove(this.group);
            this.group = new Group();

            for (let sec_name in data) {
                let sec = data[sec_name];
                secNSegs[sec.index] = sec.nseg;
                secNames[sec.index] = sec_name;

                for (let seg_idx = 0; seg_idx < sec.diam.length; seg_idx++) {
                    let v = new Vector3(sec.xcenter[seg_idx], sec.ycenter[seg_idx], sec.zcenter[seg_idx]);
                    let axis = new Vector3(sec.xdirection[seg_idx], sec.ydirection[seg_idx], sec.zdirection[seg_idx]);
                    axis.normalize();
                    let rotQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);

                    let length = sec.length[seg_idx];
                    let distance = sec.distance[seg_idx];
                    let scaleLength = distance / length;

                    let openEnded = /^spine/.test(sec_name) ? false : true;
                    let mesh = new Mesh(
                            new CylinderGeometry(sec.diam[seg_idx] / 2, sec.diam[seg_idx] / 2, length, 20, 1, openEnded),
                            new MeshLambertMaterial({color: getColor(sec_name), side: DoubleSide}));
                    mesh.scale.setY(scaleLength);
                    mesh.setRotationFromQuaternion(rotQuat);
                    mesh.position.copy(v);
                    mesh.name = sec_name + '_' + seg_idx;

                    allSegNames.push(mesh.name);

                    this.group.add(mesh);
                }
            }
            this.ea.publish('seg:all', allSegNames);

            this.scene.add(this.group);
        }));

        // FIXME this is copy/paste to hightlight voltage gradient
        this.subscriptions.push(this.ea.subscribe('sim:gradient', x => {
            let voltagesAtX = [];
            for (let i = 0, len = simulation.length; i < len; i++) {
                if (x <= simulation[i][0]) {
                    voltagesAtX = simulation[i];
                    break;
                }
            }

            let secIdx = 0, segIdx = 0, secSegIdxEnd = secNSegs[0];
            voltagesAtX.forEach((v, i) => {
                if (i === 0) {
                    return;
                }
                let idx = i - 1;
                if (idx == secSegIdxEnd) { // new section
                    secIdx++;
                    segIdx = 0;
                    secSegIdxEnd = idx + secNSegs[secIdx];
                }

                let meshName = secNames[secIdx] + '_' + segIdx;
                let mesh = this.group.getObjectByName(meshName);

                let v_normalized = (v - voltageMin) / (voltageMax - voltageMin);

                mesh.material.color = new Color(getColor(mesh.name)).lerp(new Color(spike_color), v_normalized);

                segIdx++;
            });
        }));

        this.subscriptions.push(this.ea.subscribe('sim:voltage', voltages => {
            // event is fired when simulation is running
            // voltages is the array in order of section segments: [time, sec0_seg0_v, sec0_seg1_v, sec1_seg0_v, ...]
            if (!this.isSimulationRunning) {
                // the first voltage message when simulation started
                simulation = [];
                recordings = [];
                this.isSimulationRunning = true;
                voltageMin = -70;
                voltageMax = 20;
            }

            let secIdx = 0, segIdx = 0, secSegIdxEnd = secNSegs[0];
            let record = [voltages[0]]; // first element is time
            voltages.forEach((v, i) => {
                if (i === 0) {
                    return;
                }
                let idx = i - 1;
                if (idx == secSegIdxEnd) { // new section
                    secIdx++;
                    segIdx = 0;
                    secSegIdxEnd = idx + secNSegs[secIdx];
                }

                let meshName = secNames[secIdx] + '_' + segIdx;
                let mesh = this.group.getObjectByName(meshName);

                voltageMin = Math.min(v, voltageMin);
                voltageMax = Math.max(v, voltageMax);
                let v_normalized = (v - voltageMin) / (voltageMax - voltageMin);

                mesh.material.color = new Color(getColor(mesh.name)).lerp(new Color(spike_color), v_normalized);

                let recordFromIdx = recordFrom.indexOf(meshName);
                if (recordFromIdx > -1) {
                    record[recordFromIdx + 1] = v; // first element is time
                }

                segIdx++;
            });

            recordings.push(record);
            this.ea.publish('sim:recordings', recordings);
            simulation.push(voltages);
        }));

        this.subscriptions.push(this.ea.subscribe('sim:record', v => {
            recordFrom = v;
        }));

        this.subscriptions.push(this.ea.subscribe('sim:done', () => {
            this.isSimulationRunning = false;
            this.group.children.forEach(mesh => {
                mesh.material.color = new Color(getColor(mesh.name));
            });
        }));
    }

    detached() {
        this.runAnimation = false;
        for (let subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.canvasRef.removeEventListener('mousemove', this.onMouseMove);
        this.renderer.dispose();
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    updateLightPosition = () => {
        this.light.position.copy(this.camera.position);
        this.light.target.position.copy(this.controls.target);
        this.light.target.updateMatrixWorld();
    }

    onMouseMove = (evnt) => {
        const mouse = new Vector2();
        mouse.x =  (evnt.offsetX / this.canvasRef.clientWidth)  * 2 - 1;
        mouse.y = -(evnt.offsetY / this.canvasRef.clientHeight) * 2 + 1;

        this.raycaster.setFromCamera(mouse, this.camera);

        let intersects = this.raycaster.intersectObjects(this.group.children);

        if (intersects.length > 0) {
            let name = intersects[0].object.name;
            let [sec_name, seg_idx_name] = name.split('_');
            let seg_idx = parseInt(seg_idx_name);
            let sec = this.data[sec_name];

            this.secHovered = sec_name;
            this.secHoveredIdx = seg_idx;

            // when showing dendrogram these lines will be present
            let length = this.dendrogramLines ? sec.length[seg_idx] : sec.distance[seg_idx];
            this.box.setFromObject(new Mesh(new BoxGeometry(sec.diam[seg_idx], length, sec.diam[seg_idx], 2, 2, 2)));
            let segCylinderMesh = this.group.getObjectByName(name);
            this.box.setRotationFromQuaternion(segCylinderMesh.quaternion);
            this.box.position.copy(segCylinderMesh.position);
            this.box.updateMatrix();

            this.box.visible = true;
        } else {
            this.box.visible = false;

            this.secHovered = null;
            this.secHoveredIdx = null;
        }
    }

    animate = (timestamp) => {
        if (!this.runAnimation) {
            return;
        }

        if (this.width != this.viewportRef.clientWidth || this.height != this.viewportRef.clientHeight) {
            this.width  = this.viewportRef.clientWidth;
            this.height = this.viewportRef.clientHeight;

            if (this.camera.type === 'OrthographicCamera') {
                let aspect = this.viewportRef.clientWidth / this.viewportRef.clientHeight;
                this.camera.left   = -frustumSize * aspect / 2;
                this.camera.right  =  frustumSize * aspect / 2;
                this.camera.top    =  frustumSize / 2;
                this.camera.bottom = -frustumSize / 2;
            } else {
                this.camera.aspect = this.width / this.height;
            }
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(this.width, this.height, false);
        }

        TweenUpdate(timestamp);

        this.controls.update();
        this.render();
        requestAnimationFrame(this.animate);
    }

    click = () => {
        if (this.secHovered) {
            this.ea.publish('seg:selected', {sec: this.secHovered, idx: this.secHoveredIdx});
        }
    }

    activate(params) {
        if (params.id) {
            this.ws.connect(params.id);
        } else if (params.url) {
            this.ws.connectUrl(params.url);
        }
        initDataModel(this.model, params);
    }
}
