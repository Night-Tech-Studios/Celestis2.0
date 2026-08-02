// Preload: expose THREE, GLTFLoader and THREE_VRM to renderer
const { contextBridge, ipcRenderer } = require('electron');

// Preload: expose deterministic API via contextBridge. Do not write directly to window when contextIsolation is enabled.
const osPlatform = (typeof process !== 'undefined' && process.platform) ? process.platform : null;

// Debug: indicate preload started and timestamp
try { console.log('[preload] preload script starting @' + (performance && performance.now ? performance.now().toFixed(2) : Date.now())); } catch (e) { /* ignore */ }
try { console.log('[preload] platform:', osPlatform || 'unknown'); } catch (e) { /* ignore */ }

// Import three and loaders via node resolution. Use try/catch so missing packages don't crash preload.
(async function(){
  // Gather variables to expose regardless of errors
  let api = {
    THREE: null,
    GLTFLoader: null,
    THREE_VRM: null,
    _gltf_method: 'none',
    preloadAttachTime: (performance && performance.now) ? performance.now() : Date.now()
  };

  try {
    // Use a runtime-safe require to avoid bundlers (webpack) attempting to resolve
    // Node core modules at build time. Prefer __non_webpack_require__ when available.
    const nativeRequire = (typeof __non_webpack_require__ === 'function') ? __non_webpack_require__ : (typeof require === 'function' ? require : null);
    const runtimeRequire = nativeRequire || (typeof require === 'function' ? require : null);
    let path = null;
    let fs = null;
    try {
      if (runtimeRequire) {
        try { path = runtimeRequire('path'); } catch(_) { path = null; }
        try { fs = runtimeRequire('fs'); } catch(_) { fs = null; }
      }
    } catch (_e) {
      path = null;
      fs = null;
    }
    // Attempt to require three. If it fails, leave as null but continue to expose.
    try {
      // Prefer require first (synchronous). If that fails, attempt a dynamic import
      try {
        const THREE = require('three');
        api.THREE = (THREE && THREE.default) ? THREE.default : THREE;
      } catch (reqErr) {
        // require may fail in some packaging/esm scenarios; try dynamic import as a fallback
        try {
          const imported = await import('three');
          api.THREE = (imported && imported.default) ? imported.default : imported;
          console.log('[preload] three loaded via dynamic import fallback');
        } catch (impErr) {
          api.THREE = null;
          console.warn('[preload] three not available via require or dynamic import');
        }
      }
    } catch (e) {
      api.THREE = null;
    }

    // Additionally, attempt to read the UMD source files for three and GLTFLoader from node_modules
    // and expose them so the renderer can inject them if module loading fails due to packaging/esm issues.
    try {
      // Resolve the three package root via package.json for more reliable paths
      let threePkgJson = null;
      try { threePkgJson = (runtimeRequire && runtimeRequire.resolve) ? runtimeRequire.resolve('three/package.json') : require.resolve('three/package.json'); } catch (_) { threePkgJson = null; }

      if (threePkgJson) {
        const threeBase = path.dirname(threePkgJson);

        // Candidate files for Three.js UMD (build/three.js is canonical, but include others)
        const threeCandidates = [
          path.join(threeBase, 'build', 'three.js'),
          path.join(threeBase, 'build', 'three.module.js'),
          path.join(threeBase, 'build', 'three.min.js'),
          path.join(threeBase, 'src', 'Three.js')
        ];

        api.__threeUmd = null;
        for (const cand of threeCandidates) {
          if (fs.existsSync(cand)) {
            try { api.__threeUmd = fs.readFileSync(cand, 'utf8'); console.log('[preload] found three UMD at ' + cand); break; } catch(err) { api.__threeUmd = null; console.log('[preload] failed reading three UMD at ' + cand + ': ' + (err && err.message)); }
          }
        }

        // Candidate paths for GLTFLoader; prefer UMD example first
        const gltfCandidates = [
          path.join(threeBase, 'examples', 'js', 'loaders', 'GLTFLoader.js'),
          path.join(threeBase, 'examples', 'jsm', 'loaders', 'GLTFLoader.js'),
          path.join(threeBase, 'examples', 'js', 'loaders', 'GLTFLoader.min.js')
        ];

        api.__gltfUmd = null;
        for (const cand of gltfCandidates) {
          if (fs.existsSync(cand)) {
            try { api.__gltfUmd = fs.readFileSync(cand, 'utf8'); console.log('[preload] found GLTF loader at ' + cand); break; } catch(err) { api.__gltfUmd = null; console.log('[preload] failed reading GLTF loader at ' + cand + ': ' + (err && err.message)); }
          }
        }

        // FBX loader support intentionally omitted; we only surface GLTF/VRM loader sources
      } else {
        api.__threeUmd = null;
        api.__gltfUmd = null;
      }
    } catch (e) {
      api.__threeUmd = null;
      api.__gltfUmd = null;
    }

    // If runtimeRequire isn't available (bundled preload), ask main for UMD strings
    try {
      if ((!api.__threeUmd || !api.__gltfUmd) && ipcRenderer && ipcRenderer.invoke) {
        const mainResult = await ipcRenderer.invoke('get-three-umd');
        console.log('[preload] get-three-umd returned:', !!(mainResult && (mainResult.three || mainResult.gltf)), ' three:', !!(mainResult && mainResult.three), ' gltf:', !!(mainResult && mainResult.gltf));
        if (mainResult && mainResult.three) api.__threeUmd = api.__threeUmd || mainResult.three;
        if (mainResult && mainResult.gltf) api.__gltfUmd = api.__gltfUmd || mainResult.gltf;
      }
    } catch (e) {
      console.log('[preload] get-three-umd invoke failed: ' + (e && e.message));
    }

    // Additionally, ask main for loader sources (jsm and examples/js) when available.
    try {
      if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
        try {
          const loaderRes = await ipcRenderer.invoke('read-loader-sources');
          console.log('[preload] read-loader-sources returned, found=', !!(loaderRes && loaderRes.found));
          api.__threeModule = loaderRes && loaderRes.threeModule ? loaderRes.threeModule : null;
          api.loaderJsm = (loaderRes && loaderRes.jsm) ? loaderRes.jsm : { gltf: null };
          api.loaderJs = (loaderRes && loaderRes.js) ? loaderRes.js : { gltf: null };

          // Backwards compatibility: if classic examples/js GLTFLoader exists, expose as __gltfUmd
          if (!api.__gltfUmd && api.loaderJs && api.loaderJs.gltf) api.__gltfUmd = api.loaderJs.gltf;
          // Expose jsm sources separately as well
          api.__gltfJsm = api.loaderJsm.gltf || null;
        } catch (e) {
          console.log('[preload] read-loader-sources invoke failed:', e && e.message);
        }
      }
    } catch (e) {
      // ignore
    }

    // Try to attach a UMD GLTFLoader if available in node_modules
    try {
      const threeMain = require.resolve('three');
      const base = path.dirname(threeMain);
      const examplesUmd = path.join(base, 'examples', 'js', 'loaders', 'GLTFLoader.js');
      if (fs.existsSync(examplesUmd)) {
        try { require(examplesUmd); } catch(_){}
        api.GLTFLoader = (api.THREE && api.THREE.GLTFLoader) ? api.THREE.GLTFLoader : null;
        api._gltf_method = 'umd';
      } else {
        try {
          const maybe = require('three/examples/jsm/loaders/GLTFLoader.js');
          api.GLTFLoader = maybe && (maybe.GLTFLoader || maybe.default || maybe);
          api._gltf_method = 'require-subpath';
        } catch (_e) {
          api.GLTFLoader = (api.THREE && api.THREE.GLTFLoader) ? api.THREE.GLTFLoader : null;
        }
      }
    } catch (err) {
      // ignore loader resolution errors
    }

    // Try pixiv three-vrm
    try {
      let THREE_VRM = null;
      try { THREE_VRM = require('@pixiv/three-vrm'); } catch (e) { }
      if (!THREE_VRM) {
        try { const mod = await import('@pixiv/three-vrm'); THREE_VRM = mod && (mod.default || mod); } catch(_){}
      }
      api.THREE_VRM = (THREE_VRM && THREE_VRM.default) ? THREE_VRM.default : THREE_VRM;
    } catch (_) {}

    // Try to load Babylon core, loaders and VRM loader (node-side) so they register with the global BABYLON when possible
    try {
      let BABYLON = null;
      let babylonLoaders = null;
      let babylonVrm = null;
      try { BABYLON = runtimeRequire && runtimeRequire('@babylonjs/core'); } catch(_) { BABYLON = null; }
      if (!BABYLON) {
        try { const mod = await import('@babylonjs/core'); BABYLON = mod && (mod.default || mod); } catch(_) { BABYLON = null; }
      }

      try { babylonLoaders = runtimeRequire && runtimeRequire('@babylonjs/loaders'); } catch(_) { babylonLoaders = null; }
      if (!babylonLoaders) {
        try { const mod = await import('@babylonjs/loaders'); babylonLoaders = mod && (mod.default || mod); } catch(_) { babylonLoaders = null; }
      }

      try { babylonVrm = runtimeRequire && runtimeRequire('babylon-vrm-loader'); } catch(_) { babylonVrm = null; }
      if (!babylonVrm) {
        try { const mod = await import('babylon-vrm-loader'); babylonVrm = mod && (mod.default || mod); } catch(_) { babylonVrm = null; }
      }

      api.BABYLON = BABYLON || null;
      api.babylonLoaders = babylonLoaders || null;
      api.babylonVrm = babylonVrm || null;
      api._babylon_method = (api.BABYLON ? 'require' : 'none');
    } catch (e) {
      api.BABYLON = null;
      api.babylonLoaders = null;
      api.babylonVrm = null;
    }

    api.preloadAttachTime = (performance && performance.now) ? performance.now() : Date.now();
  } catch (e) {
    // Top-level preload error should not prevent exposing an API
    try { console.warn('[preload] module attach warning: ' + (e && e.message)); } catch(_){}
  }

  // Always expose a minimal celestis object so renderer can detect preload existence
  try {
    contextBridge.exposeInMainWorld('celestis', {
      isElectron: true,
      platform: osPlatform,
      three: api.THREE,
      gltfLoader: api.GLTFLoader,
      // Expose UMD source strings so the renderer can inject them when module resolution fails.
      // Expose both the newer aliases and the older underscored keys for backwards compatibility
      threeUmd: api.__threeUmd || null,
      gltfUmd: api.__gltfUmd || null,
      __threeUmd: api.__threeUmd || null,
      __gltfUmd: api.__gltfUmd || null,
        // Babylon exposures
        babylon: api.BABYLON || null,
        babylonLoaders: api.babylonLoaders || null,
        babylonVrm: api.babylonVrm || null,
        threeVrm: api.THREE_VRM,
      gltfMethod: api._gltf_method,
      preloadAttachTime: api.preloadAttachTime,
      // expose raw UMD strings for debugging and fallback injection
      __threeUmd: api.__threeUmd || null,
      __gltfUmd: api.__gltfUmd || null,
      // Expose jsm/js loader sources and three.module content when available
      loaderJsm: api.loaderJsm || { gltf: null },
      loaderJs: api.loaderJs || { gltf: null },
      threeModuleSource: api.__threeModule || null,
      // jsm content aliases
      __gltfJsm: api.__gltfJsm || null,
        _babylon_method: api._babylon_method || 'none',
      onThreeReady: (cb) => {
        try { window.addEventListener('threejs-ready', cb); } catch (e) { try { cb(); } catch(_){} }
      }
    });

    // If three is present, set globals and dispatch event
    try {
      if (api.THREE) {
        try { window.THREE = api.THREE; } catch(_){}
        if (api.THREE_VRM) { try { window.THREE_VRM = api.THREE_VRM; } catch(_){} }
        window.__threeModulesLoaded = true;
        window.__preloadAttachTime = api.preloadAttachTime;
        try { window.dispatchEvent(new CustomEvent('threejs-ready')); } catch(_){}
      }
    } catch (_) {}

    // If Babylon core was attached by preload, expose it to renderer global so loaders registered here become available
    try {
      if (api.BABYLON) {
        try { window.BABYLON = api.BABYLON; } catch(_){}
        if (api.babylonVrm) { try { window.BABYLON_VRM = api.babylonVrm; } catch(_){} }
        try { window.dispatchEvent(new CustomEvent('babylon-ready')); } catch(_){ }
      }
    } catch (_) {}

    try {
      console.log('[preload] attach results @' + (api.preloadAttachTime || 'na') + ' -> THREE:' + (!!api.THREE) + ' GLTFLoader:' + (!!api.GLTFLoader) + ' THREE_VRM:' + (!!api.THREE_VRM) + ' method:' + (api._gltf_method || 'unknown'));
    } catch(_){}
  } catch (e) {
    // ignore
  }
})();

// Expose a small safe API for IPC if contextIsolation is enabled in future
// Expose IPC methods under electronAPI
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, listener) => ipcRenderer.on(channel, listener)
});
