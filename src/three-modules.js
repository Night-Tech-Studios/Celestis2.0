console.log('[three-modules.js] Starting ES module imports...');

import * as THREE_NS from '../node_modules/three/build/three.module.js';
console.log('[three-modules.js] THREE imported');

import { GLTFLoader as GLTFLoaderNS } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
console.log('[three-modules.js] GLTFLoader imported');


// Attach to window for the rest of the app which expects global THREE
window.THREE = window.THREE || {};
Object.assign(window.THREE, THREE_NS);
window.THREE.GLTFLoader = GLTFLoaderNS;
// FBXLoader intentionally not imported (FBX support removed)
console.log('[three-modules.js] THREE loaded:', !!window.THREE);
console.log('[three-modules.js] THREE.REVISION:', window.THREE.REVISION);
console.log('[three-modules.js] GLTFLoader loaded:', !!window.THREE.GLTFLoader);

// Flag to indicate module-based loaders are ready
window.__threeModulesLoaded = true;

// Signal ready
console.log('[three-modules.js] Dispatching threejs-ready event');
window.dispatchEvent(new CustomEvent('threejs-ready'));
