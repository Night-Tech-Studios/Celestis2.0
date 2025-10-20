(function(){
  function validateVRMFile(buffer, debugLog){
    try {
      debugLog && debugLog('Validating VRM file, buffer size: ' + buffer.length + ' bytes');
      if (buffer.length < 4) return false;
      const header = new Uint32Array(buffer.slice(0, 4));
      const magic = header[0];
      if (magic === 0x46546C67) return true; // GLB
      if (buffer.length >= 50){
        try{
          const textStart = new TextDecoder('utf-8',{fatal:false}).decode(buffer.slice(0, Math.min(1000, buffer.length)));
          if (textStart.includes('asset') || textStart.includes('meshes')) return true;
        }catch(_){/*ignore*/}
      }
      return true; // let loader decide
    } catch(_){ return true; }
  }

  async function loadVRMFromBuffer(ctx, buffer, filePath){
    const { THREE, debugLog } = ctx;
    debugLog('[vrmLoader.js] Starting loadVRMFromBuffer, buffer size: ' + buffer.length);

    // Helper to convert Node Buffer / Uint8Array to ArrayBuffer for GLTFLoader.parse
    function toArrayBuffer(buf){
      if (buf instanceof ArrayBuffer) return buf;
      if (ArrayBuffer.isView(buf)) {
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
      // Fallback: create a Uint8Array copy
      return Uint8Array.from(buf).buffer;
    }

    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    try{
      if (!validateVRMFile(buffer, debugLog)){
        throw new Error('Invalid VRM/GLTF file format');
      }
      debugLog('[vrmLoader.js] File validation passed');

      // Preferred path: use Pixiv three-vrm loader utilities if available (UMD exposes window.THREE_VRM)
      if (window.THREE_VRM && (window.THREE_VRM.VRM || window.THREE_VRM.VRMLoaderPlugin)){
        debugLog('[vrmLoader.js] Detected window.THREE_VRM, attempting to use Pixiv VRM APIs');

        // If a convenience VRMLoader exists (some builds may expose it), use it
        if (THREE.VRMLoader) {
          debugLog('[vrmLoader.js] Using THREE.VRMLoader (UMD)');
          const loader = new THREE.VRMLoader();
          let gltf;
          if (typeof loader.parse === 'function') {
            const arrayBuffer = toArrayBuffer(buffer);
            gltf = await new Promise((resolve, reject)=>{
              const tid = setTimeout(()=>reject(new Error('VRM loading timeout after 30s')), 30000);
              loader.parse(arrayBuffer, '', (g)=>{ clearTimeout(tid); resolve(g); }, (e)=>{ clearTimeout(tid); reject(e); });
            });
          } else {
            gltf = await new Promise((resolve, reject)=>{
              const tid = setTimeout(()=>reject(new Error('VRM loading timeout after 30s')), 30000);
              loader.load(url, (v)=>{ clearTimeout(tid); resolve(v); }, undefined, (e)=>{ clearTimeout(tid); reject(e); });
            });
          }

          // Some VRMLoader implementations return a VRM instance already
          if (gltf && gltf.scene && window.THREE_VRM && window.THREE_VRM.VRM) {
            try {
              const vrm = await window.THREE_VRM.VRM.from(gltf);
              debugLog('[vrmLoader.js] Converted GLTF to VRM using THREE_VRM.VRM.from');
              return { gltf, vrm, scene: vrm.scene || gltf.scene };
            } catch(e) {
              debugLog('[vrmLoader.js] VRM.from failed, returning raw gltf scene: ' + (e.message || e));
              return { gltf, vrm: { scene: gltf.scene, animations: gltf.animations || [], humanoid: null }, scene: gltf.scene };
            }
          }
        }

        // Fallback: use a GLTFLoader, register Pixiv VRMLoaderPlugin if available, then return the VRM
          if (THREE.GLTFLoader) {
            debugLog('[vrmLoader.js] Using GLTFLoader and registering VRMLoaderPlugin where available');
            const loader = new THREE.GLTFLoader();

            // If Pixiv provides the plugin constructors on window.THREE_VRM, register it
            if (window.THREE_VRM && window.THREE_VRM.VRMLoaderPlugin) {
              try {
                loader.register((parser) => new window.THREE_VRM.VRMLoaderPlugin(parser));
                debugLog('[vrmLoader.js] Registered VRMLoaderPlugin on GLTFLoader');
              } catch (e) {
                debugLog('[vrmLoader.js] Failed to register VRMLoaderPlugin: ' + (e.message || e));
              }
            }

            let gltf;
            if (typeof loader.parse === 'function') {
              const arrayBuffer = toArrayBuffer(buffer);
              gltf = await new Promise((resolve, reject)=>{
                const tid = setTimeout(()=>reject(new Error('VRM loading timeout after 30s')), 30000);
                loader.parse(arrayBuffer, '', (g)=>{ clearTimeout(tid); resolve(g); }, (e)=>{ clearTimeout(tid); reject(e); });
              });
            } else {
              gltf = await new Promise((resolve, reject)=>{
                const tid = setTimeout(()=>reject(new Error('VRM loading timeout after 30s')), 30000);
                loader.load(url, (g)=>{ clearTimeout(tid); resolve(g); }, undefined, (e)=>{ clearTimeout(tid); reject(e); });
              });
            }

            // If the plugin attached a VRM to userData, return that
            if (gltf.userData && gltf.userData.vrm) {
              const vrm = gltf.userData.vrm;
              try {
                if (window.THREE_VRM && window.THREE_VRM.VRM && window.THREE_VRM.VRMUtils) {
                  // Optimize as recommended by example
                  window.THREE_VRM.VRMUtils.removeUnnecessaryVertices(gltf.scene);
                  window.THREE_VRM.VRMUtils.combineSkeletons(gltf.scene);
                  window.THREE_VRM.VRMUtils.combineMorphs(vrm);
                  debugLog('[vrmLoader.js] Applied VRMUtils optimizations');
                }
              } catch (e) { debugLog('[vrmLoader.js] VRMUtils optimization failed: ' + (e.message || e)); }

              debugLog('[vrmLoader.js] Returning VRM from gltf.userData.vrm');
              return { gltf, vrm, scene: vrm.scene || gltf.scene };
            }

            // Otherwise, try explicit conversion if available
            if (window.THREE_VRM && window.THREE_VRM.VRM) {
              try {
                const vrm = await window.THREE_VRM.VRM.from(gltf);
                debugLog('[vrmLoader.js] VRM created via THREE_VRM.VRM.from');
                if (window.THREE_VRM && window.THREE_VRM.VRMUtils) {
                  window.THREE_VRM.VRMUtils.removeUnnecessaryVertices(gltf.scene);
                  window.THREE_VRM.VRMUtils.combineSkeletons(gltf.scene);
                  window.THREE_VRM.VRMUtils.combineMorphs(vrm);
                }
                return { gltf, vrm, scene: vrm.scene || gltf.scene };
              } catch (e) {
                debugLog('[vrmLoader.js] THREE_VRM.VRM.from failed: ' + (e.message || e));
              }
            }

            // Last-resort: return raw gltf.scene
            return { gltf, vrm: { scene: gltf.scene, animations: gltf.animations || [], humanoid: null }, scene: gltf.scene };
          }
      }

      // Last-resort path: no Pixiv VRM helpers available — try GLTFLoader and return raw gltf
      if (!THREE.GLTFLoader) {
        throw new Error('No suitable loader available (neither THREE_VRM nor THREE.GLTFLoader found)');
      }

      debugLog('[vrmLoader.js] Using GLTFLoader (no THREE_VRM present)');
      const loader = new THREE.GLTFLoader();
      let gltf;
      if (typeof loader.parse === 'function') {
        const arrayBuffer = toArrayBuffer(buffer);
        gltf = await new Promise((resolve, reject)=>{
          const tid = setTimeout(()=>reject(new Error('VRM loading timeout after 30s')), 30000);
          loader.parse(arrayBuffer, '', (g)=>{ clearTimeout(tid); resolve(g); }, (e)=>{ clearTimeout(tid); reject(e); });
        });
      } else {
        gltf = await new Promise((resolve, reject)=>{
          const tid = setTimeout(()=>reject(new Error('VRM loading timeout after 30s')), 30000);
          loader.load(url, (g)=>{ clearTimeout(tid); resolve(g); }, undefined, (e)=>{ clearTimeout(tid); reject(e); });
        });
      }

      return { gltf, vrm: { scene: gltf.scene, animations: gltf.animations || [], humanoid: null }, scene: gltf.scene };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  window.CelestisModules = window.CelestisModules || {};
  window.CelestisModules.vrmLoader = { loadVRMFromBuffer };
})();
