// Use the safe IPC surface exposed by preload
const ipc = (window && window.electronAPI) ? window.electronAPI : { invoke: async()=>{throw new Error('IPC not available');}, send: ()=>{}, on: ()=>{} };

let renderer, scene, camera, clock, mixer, currentModel;

const canvas = document.getElementById('previewCanvas');
const statusEl = document.getElementById('status');

// Helper: import three.module.js by URL (avoids bare specifier import('three'))
async function importThreeByUrl() {
  try {
    if (typeof window !== 'undefined' && window.THREE) return window.THREE;
    const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
    const mod = await import(threeUrl);
    const three = (mod && (mod.default || mod));
    if (three) {
      window.THREE = three;
      return three;
    }
    return null;
  } catch (e) {
    console.warn('[preview] importThreeByUrl failed:', e && e.message);
    return null;
  }
}

// Helper: fetch a jsm loader source, rewrite its imports from 'three' to a blob URL
// that contains three.module.js, then dynamic-import the rewritten module blob.
async function importJsmLoaderByPath(loaderRelPath) {
  try {
    const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
    const loaderUrl = new URL(loaderRelPath, import.meta.url).href;

    const [threeRes, loaderRes] = await Promise.all([fetch(threeUrl), fetch(loaderUrl)]);
    if (!threeRes.ok || !loaderRes.ok) {
      console.warn('[preview] importJsmLoaderByPath: fetch failed', threeRes.status, loaderRes.status);
      return null;
    }

    const threeSrc = await threeRes.text();
    const loaderSrc = await loaderRes.text();

    const threeBlobUrl = URL.createObjectURL(new Blob([threeSrc], { type: 'text/javascript' }));
    const rewritten = loaderSrc.replace(/from\s+['"]three['"]/g, `from '${threeBlobUrl}'`);
    const loaderBlobUrl = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));

    try {
      const mod = await import(loaderBlobUrl);
      return mod;
    } finally {
      try { URL.revokeObjectURL(loaderBlobUrl); } catch(_){}
      try { URL.revokeObjectURL(threeBlobUrl); } catch(_){}
    }
  } catch (e) {
    console.warn('[preview] importJsmLoaderByPath failed:', e && e.message);
    return null;
  }
}

function debug(msg){
  console.log('[preview]', msg);
  if (statusEl) statusEl.textContent = msg;
}

async function initThree(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.position.set(0, 1.4, 3);

  renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);

  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(2,3,2);
  scene.add(dir);

  clock = new THREE.Clock();

  window.addEventListener('resize', ()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  animate();
}

// Determine preview renderer preference (query main/settings). Try preload-exposed api first
async function getRendererPreference(){
  try{
    // If electronAPI exposes invoke -> ask main for settings
    if (ipc && ipc.invoke) {
      try {
        const settings = await ipc.invoke('load-settings');
        if (settings && settings.rendererEngine) return settings.rendererEngine;
      } catch(_){}
    }
  }catch(_){ }
  // fallback to window marker if present
  try { return window.__rendererPreference || null; } catch(_) { return null; }
}

function drawImageToPreviewCanvas(buffer, name) {
  try{
    const arr = (buffer instanceof ArrayBuffer) ? new Uint8Array(buffer) : (buffer && buffer.buffer ? new Uint8Array(buffer.buffer || buffer) : new Uint8Array(buffer));
    const blob = new Blob([arr], { type: 'image/*' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth; canvas.height = window.innerHeight;
        ctx.fillStyle = '#072'; ctx.fillRect(0,0,canvas.width,canvas.height);
        // fit image
        const maxW = canvas.width * 0.9; const maxH = canvas.height * 0.85;
        let w = img.width, h = img.height;
        const ratio = Math.min(maxW/w, maxH/h, 1);
        w *= ratio; h *= ratio;
        ctx.drawImage(img, (canvas.width-w)/2, (canvas.height-h)/2, w, h);
        URL.revokeObjectURL(url);
        debug('Image rendered to preview canvas: ' + (name||'image'));
      } catch (e) { URL.revokeObjectURL(url); debug('Preview image draw error: ' + e.message); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); debug('Preview image load failed'); };
    img.src = url;
  }catch(e){ debug('drawImageToPreviewCanvas error: ' + e.message); }
}

async function loadVRMFromBuffer(buffer, fileName){
  try{
    debug('Loading avatar: ' + (fileName||'memory'));

    // remove old
    if (currentModel && currentModel.scene && scene) scene.remove(currentModel.scene);
    mixer = null;

    // Use the same module that app uses if available
    // Try the centralized module loader first (preferred)
    let usedModuleLoader = false;
    if (window.CelestisModules?.vrmLoader?.loadVRMFromBuffer) {
      try {
        const res = await window.CelestisModules.vrmLoader.loadVRMFromBuffer({ THREE, debug }, buffer, fileName);
        currentModel = res.vrm || { scene: res.scene, animations: res.gltf?.animations||[] };
        if (currentModel.scene) scene.add(currentModel.scene);
        if (res.gltf && res.gltf.animations && res.gltf.animations.length>0) {
          mixer = new THREE.AnimationMixer(res.scene || currentModel.scene);
        }
        fitModelToView(res.scene || currentModel.scene);
        debug('Avatar loaded via centralized module loader');
        usedModuleLoader = true;
        return;
      } catch (e) {
        debug('Module loader failed, falling back: ' + (e?.message||e));
      }
    }

    // Ensure GLTFLoader exists: try multiple strategies (avoid bare-specifier imports)
    if (!THREE.GLTFLoader) {
      debug('GLTFLoader not present on window.THREE, attempting to import jsm loader safely');
      try {
        let mod = null;

        // 1) Prefer loader sources exposed by preload (window.celestis) if available
        try {
          if (window.celestis && window.celestis.loaderJsm && window.celestis.loaderJsm.gltf && window.celestis.threeModuleSource) {
            try {
              const threeSrc = window.celestis.threeModuleSource;
              const loaderSrc = window.celestis.loaderJsm.gltf;
              const threeBlob = URL.createObjectURL(new Blob([threeSrc], { type: 'text/javascript' }));
              const rewritten = loaderSrc.replace(/from\s+['"]three['"]/g, `from '${threeBlob}'`);
              const loaderBlob = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
              mod = await import(loaderBlob);
              try { URL.revokeObjectURL(loaderBlob); } catch(_){}
              try { URL.revokeObjectURL(threeBlob); } catch(_){}
            } catch (e) {
              mod = null;
            }
          }
        } catch (_) { mod = null; }

        // 2) Try fetching and rewriting the jsm from node_modules
        if (!mod) {
          mod = await importJsmLoaderByPath('../node_modules/three/examples/jsm/loaders/GLTFLoader.js');
        }

        // 3) If we have a module, attach its constructor
        if (mod) {
          const GLTFLoader = mod.GLTFLoader || mod.default || mod;
          if (!window.THREE) await importThreeByUrl();
          window.THREE = window.THREE || (window.THREE);
          window.THREE.GLTFLoader = GLTFLoader;
          debug('Imported jsm GLTFLoader and attached to window.THREE');
        }
      } catch (e) {
        debug('Safe import of GLTFLoader failed: ' + (e?.message||e));
      }
    }

    if (!THREE.GLTFLoader) {
      throw new Error('GLTFLoader not found');
    }

    // Create blob URL and load with GLTFLoader
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    const loader = new THREE.GLTFLoader();
    loader.load(url, async (gltf)=>{
      try {
        URL.revokeObjectURL(url);

        // Try converting to VRM via pixiv three-vrm API (handle multiple export shapes)
        let vrm = null;
        try {
          const tv = window.THREE_VRM || window.THREE?.VRM || null;
          if (window.THREE_VRM) {
            // common shapes: window.THREE_VRM.VRM.from, window.THREE_VRM.from, default export
            if (window.THREE_VRM.VRM && typeof window.THREE_VRM.VRM.from === 'function') {
              vrm = await window.THREE_VRM.VRM.from(gltf);
            } else if (typeof window.THREE_VRM.from === 'function') {
              vrm = await window.THREE_VRM.from(gltf);
            } else if (window.THREE_VRM.default && window.THREE_VRM.default.VRM && typeof window.THREE_VRM.default.VRM.from === 'function') {
              vrm = await window.THREE_VRM.default.VRM.from(gltf);
            } else if (gltf.userData && gltf.userData.vrm) {
              vrm = gltf.userData.vrm;
            }
          }
        } catch (e) {
          debug('THREE_VRM conversion attempt failed: ' + (e?.message||e));
        }

        // If no vrm conversion, fall back to raw gltf.scene
        if (!vrm) {
          currentModel = { scene: gltf.scene, animations: gltf.animations || [] };
          scene.add(gltf.scene);
          fitModelToView(gltf.scene);
          debug('Avatar loaded via GLTFLoader (raw gltf)');
          return;
        }

        // If we have a VRM-like object, add it
        currentModel = vrm || { scene: gltf.scene, animations: gltf.animations || [] };
        if (currentModel.scene) scene.add(currentModel.scene);
        if (currentModel.animations && currentModel.animations.length > 0) {
          mixer = new THREE.AnimationMixer(currentModel.scene);
        }
        fitModelToView(currentModel.scene || gltf.scene);
        debug('Avatar loaded as VRM');

      } catch (err) {
        URL.revokeObjectURL(url);
        debug('Error processing loaded gltf: ' + (err?.message||err));
      }
    }, undefined, (err)=>{
      URL.revokeObjectURL(url);
      debug('Failed to load gltf: ' + (err?.message||err));
    });
    
  }catch(e){
    debug('Error loading VRM: ' + (e?.message||e));
  }
}

function fitModelToView(obj){
  try{
    if (!obj) return;

    // Reset transforms that may cause measurement issues
    obj.updateMatrixWorld(true);
    obj.position.set(0,0,0);
    obj.rotation.set(0,0,0);
    obj.scale.setScalar(1);

    const box = new THREE.Box3().setFromObject(obj);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // Move object so its center is at origin
      obj.position.x -= center.x;
      obj.position.y -= center.y;
      obj.position.z -= center.z;

      const maxDim = Math.max(size.x, size.y, size.z, 0.0001);

      // Compute ideal scale to make height roughly 1.6-1.8 units tall
      const targetHeight = 1.7;
      let scale = targetHeight / Math.max(size.y, 0.0001);
      // Clamp extreme scaling
      scale = Math.min(Math.max(scale, 0.1), 10);
      obj.scale.setScalar(scale);

      // Recompute bounds after scaling
      const scaledBox = new THREE.Box3().setFromObject(obj);
      const scaledSize = scaledBox.getSize(new THREE.Vector3());

      const distance = Math.max(scaledSize.length(), 1) * 2.2;
      // Place camera at a reasonable offset and look at origin
      camera.position.set(distance, Math.max(1.0, scaledSize.y) * 0.7, distance);
      camera.lookAt(0, 0, 0);
    } else {
      // Fallback camera placement
      camera.position.set(0, 1.5, 3);
      camera.lookAt(0, 1, 0);
    }
  }catch(e){console.warn(e)}
}

function animate(){
  requestAnimationFrame(animate);
  const delta = clock ? clock.getDelta() : 0.016;
  if (mixer) mixer.update(delta);
  if (renderer && scene && camera) renderer.render(scene, camera);
}

ipc.on('vrm-selected', async (_e, filePath)=>{
  debug('Main: vrm-selected ' + filePath);
  try{
    const buffer = await ipc.invoke('read-vrm-file', filePath);
    await loadVRMFromBuffer(buffer, filePath.split(/[\\\/]/).pop());
  }catch(e){ debug('Failed to read VRM from main: ' + (e?.message||e)); }
});

// When an internal avatar is selected, main sends read-internal-avatar flow; preview can listen for a custom message
ipc.on('preview-load-buffer', async (_e, buffer, name)=>{
  try{
    // If the payload looks like an image (by filename extension or magic bytes), prefer 2D drawing
    const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const nameLower = (name || '').toLowerCase();
    const isImageByName = imageExts.some(ext => nameLower.endsWith(ext));

    // helper to examine magic bytes
    const bytes = (buffer instanceof ArrayBuffer) ? new Uint8Array(buffer) : (buffer && buffer.buffer ? new Uint8Array(buffer.buffer || buffer) : new Uint8Array(buffer));
    const isPng = bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    const isJpeg = bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8;
    const isGif = bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46; // 'GIF'
    const isWebp = bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // 'RIFF'
                   bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50; // 'WEBP'

    const isImage = isImageByName || isPng || isJpeg || isGif || isWebp;

    if (isImage) {
      drawImageToPreviewCanvas(buffer, name);
      return;
    }

    const pref = await getRendererPreference();
    if (pref === '2d') {
      // fallback: if settings prefer 2D but we didn't detect an image, still try image draw
      try {
        drawImageToPreviewCanvas(buffer, name);
        return;
      } catch (_) {
        // fall through to 3D loader
      }
    }

    // buffer arrives as ArrayBuffer-like; ensure it's a Uint8Array
    const arr = bytes;
    await loadVRMFromBuffer(arr, name);
  }catch(e){ debug('preview-load-buffer failed: ' + (e?.message||e)); }
});

// allow renderer to request preview to open when needed
ipc.on('open-preview', ()=>{
  try{ if (window.focus) window.focus(); }catch(_){ }
});

// Initialize according to preference
(async function(){
  try{
    const pref = await getRendererPreference();
    debug('Preview renderer preference: ' + pref);
    if (pref === '2d') {
      debug('Preview starting in 2D mode');
      // nothing else needed; preview will render images when requested
    } else {
      // Ensure THREE is available (try safe import by URL) before initializing
      try { await importThreeByUrl(); } catch(_){}
      initThree();
    }
  }catch(e){
    debug('Error initializing preview: ' + (e?.message||e));
    try { await importThreeByUrl(); } catch(_){}
    initThree();
  }
  debug('Preview ready');
})();
