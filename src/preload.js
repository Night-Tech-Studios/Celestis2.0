// Preload: expose THREE, GLTFLoader and THREE_VRM to renderer
const { contextBridge, ipcRenderer } = require('electron');

// Preload: expose deterministic API via contextBridge. Do not write directly to window when contextIsolation is enabled.
const osPlatform = (typeof process !== 'undefined' && process.platform) ? process.platform : null;

// Debug: indicate preload started and timestamp
try { console.log('[preload] preload script starting @' + (performance && performance.now ? performance.now().toFixed(2) : Date.now())); } catch (e) { /* ignore */ }
try { console.log('[preload] platform:', osPlatform || 'unknown'); } catch (e) { /* ignore */ }

// Import three and loaders via node resolution. Use try/catch so missing packages don't crash preload.
(async function(){
  try {
    const path = require('path');
    const fs = require('fs');
    const THREE = require('three');
    let GLTFLoader = null;

    // Robust strategy: avoid dynamic ESM imports (they may trigger fetch/file:// issues in some Electron setups).
    // Prefer requiring the UMD example loader which attaches onto the global THREE object.
    try {
      const threeMain = require.resolve('three');
      const base = path.dirname(threeMain);
      const examplesUmd = path.join(base, 'examples', 'js', 'loaders', 'GLTFLoader.js');
      if (fs.existsSync(examplesUmd)) {
        // execute the UMD file which typically registers onto the global THREE object
        require(examplesUmd);
        GLTFLoader = (THREE && THREE.GLTFLoader) ? THREE.GLTFLoader : null;
        var _gltf_method = 'umd';
        try { console.log('[preload] GLTFLoader attached via UMD require'); } catch(_){}
      } else {
        // fallback: attempt to require by package subpath (may fail on newer three exports)
        try {
          const maybe = require('three/examples/jsm/loaders/GLTFLoader.js');
          GLTFLoader = maybe && (maybe.GLTFLoader || maybe.default || maybe);
          var _gltf_method = 'require-subpath';
          try { console.log('[preload] GLTFLoader loaded via require subpath'); } catch(_){}
        } catch (_e) {
          GLTFLoader = (THREE && THREE.GLTFLoader) ? THREE.GLTFLoader : null;
          var _gltf_method = (GLTFLoader ? 'attached' : 'none');
        }
      }
    } catch (err) {
      // If anything here throws, we give up gracefully and continue without GLTFLoader
      GLTFLoader = (THREE && THREE.GLTFLoader) ? THREE.GLTFLoader : null;
      var _gltf_method = (GLTFLoader ? 'attached' : 'none');
    }

    let THREE_VRM = null;
    try {
      THREE_VRM = require('@pixiv/three-vrm');
    } catch (e) {
      try {
        const vrmMod = await import('@pixiv/three-vrm');
        THREE_VRM = vrmMod && (vrmMod.default || vrmMod);
      } catch (_e) {
        THREE_VRM = null;
      }
    }

    // Build an API object to expose via contextBridge
    try {
      const api = {
        THREE: (THREE && THREE.default) ? THREE.default : THREE,
        GLTFLoader: GLTFLoader,
        THREE_VRM: (THREE_VRM && THREE_VRM.default) ? THREE_VRM.default : THREE_VRM,
        _gltf_method: _gltf_method || 'unknown',
        preloadAttachTime: (performance && performance.now) ? performance.now() : Date.now()
      };

      // Expose helper methods and flags
      contextBridge.exposeInMainWorld('celestis', {
        isElectron: true,
        platform: osPlatform,
        three: api.THREE,
        gltfLoader: api.GLTFLoader,
        threeVrm: api.THREE_VRM,
        gltfMethod: api._gltf_method,
        preloadAttachTime: api.preloadAttachTime,
        onThreeReady: (cb) => {
          try {
            window.addEventListener('threejs-ready', cb);
          } catch (e) {
            // No-op in preload context; instead call immediately if ready
            try { cb(); } catch (_) {}
          }
        }
      });

      // Dispatch an event on document for backward compat (renderer code can still listen)
      try {
        const evt = new CustomEvent('threejs-ready');
        window.dispatchEvent(evt);
      } catch (e) {}

      try {
        console.log('[preload] attach results @' + (api.preloadAttachTime || 'na') + ' -> THREE:' + (!!api.THREE) + ' GLTFLoader:' + (!!api.GLTFLoader) + ' THREE_VRM:' + (!!api.THREE_VRM) + ' method:' + (api._gltf_method || 'unknown'));
      } catch(_){}
    } catch (e) {
      // ignore
    }
  } catch (e) {
    // nothing to do
  }
})();

// Expose a small safe API for IPC if contextIsolation is enabled in future
// Expose IPC methods under electronAPI
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, listener) => ipcRenderer.on(channel, listener)
});
