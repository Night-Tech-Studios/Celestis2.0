// This module tries to support two environments:
// 1) Renderer with global UMD `THREE` and `THREE_VRM` loaded (via CDN/UMD). Prefer this.
// 2) ESM-capable environment where the app can import from node_modules (rare in plain index.html).
// The helper below will prefer globals and only attempt dynamic ESM imports as fallback.

async function ensureEsmModules() {
  // Attempt no-op: in renderer we prefer global UMD objects already present
  if (typeof window !== 'undefined' && window.THREE && window.THREE_VRM) {
    return { THREE: window.THREE, THREE_VRM: window.THREE_VRM };
  }
  // Avoid importing jsm files that contain bare 'three' specifiers directly from the browser.
  // Instead fetch the three.module.js and loader source, rewrite loader imports to reference a blob URL
  // that contains three.module.js, then dynamic-import the rewritten loader module.
  try {
    // Resolve URLs relative to this module
    const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
    const loaderUrl = new URL('../node_modules/three/examples/jsm/loaders/GLTFLoader.js', import.meta.url).href;
    const vrmUrl = new URL('../node_modules/@pixiv/three-vrm/dist/three-vrm.module.js', import.meta.url).href;

    // Fetch sources
    const [threeRes, loaderRes, vrmRes] = await Promise.all([
      fetch(threeUrl),
      fetch(loaderUrl),
      fetch(vrmUrl).catch(() => null)
    ]);

    if (!threeRes.ok || !loaderRes.ok) {
      console.warn('[vrmSetup] Could not fetch three.module.js or GLTFLoader.js');
      return { THREE: null, THREE_VRM: null };
    }

    const threeSrc = await threeRes.text();
    const loaderSrc = await loaderRes.text();
    const vrmSrc = vrmRes && vrmRes.ok ? await vrmRes.text() : null;

    // Create blob URL for three.module.js
    const threeBlob = new Blob([threeSrc], { type: 'text/javascript' });
    const threeBlobUrl = URL.createObjectURL(threeBlob);

    // Rewrite loader source to import from the three blob url
    const rewrittenLoader = loaderSrc.replace(/from\s+['"]three['"]/g, `from '${threeBlobUrl}'`);
    const loaderBlob = new Blob([rewrittenLoader], { type: 'text/javascript' });
    const loaderBlobUrl = URL.createObjectURL(loaderBlob);

    // Import the rewritten loader
    const loaderMod = await import(loaderBlobUrl);

    // If we created a vrm source, try to import it similarly (it may import from 'three')
    let vrmMod = null;
    if (vrmSrc) {
      const rewrittenVrm = vrmSrc.replace(/from\s+['"]three['"]/g, `from '${threeBlobUrl}'`);
      const vrmBlob = new Blob([rewrittenVrm], { type: 'text/javascript' });
      const vrmBlobUrl = URL.createObjectURL(vrmBlob);
      try { vrmMod = await import(vrmBlobUrl); } catch (_e) { vrmMod = null; }
    }

    // cleanup blob URLs after module is loaded (modules stay in memory)
    try { URL.revokeObjectURL(loaderBlobUrl); } catch (_) {}
    try { URL.revokeObjectURL(threeBlobUrl); } catch (_) {}

    return { THREE: null, THREE_VRM: vrmMod, GLTFLoader: loaderMod };
  } catch (e) {
    console.warn('[vrmSetup] ESM dynamic fetch+import failed:', e && (e.message || e));
    return { THREE: null, THREE_VRM: null };
  }
}

export async function createVRMAwareGLTFLoader() {
  const esm = await ensureEsmModules();

  // Prefer global UMD objects
  if (typeof window !== 'undefined' && window.THREE) {
    const THREE = window.THREE;
    const loaderCtor = THREE.GLTFLoader || (window.THREE && window.THREE.GLTFLoader);
    if (!loaderCtor) throw new Error('GLTFLoader is not available in global THREE');

    const loader = new loaderCtor();

    // If Pixiv UMD is available, attempt to register plugin constructors from window.THREE_VRM
    if (window.THREE_VRM) {
      const { MToonMaterialLoaderPlugin, VRMLoaderPlugin, nodes } = window.THREE_VRM;
      const MToonNodeMaterial = nodes ? nodes.MToonNodeMaterial : null;
      if (MToonMaterialLoaderPlugin && VRMLoaderPlugin) {
        loader.register((parser) => {
          const mtoonMaterialPlugin = new MToonMaterialLoaderPlugin(parser, { materialType: MToonNodeMaterial });
          return new VRMLoaderPlugin(parser, { mtoonMaterialPlugin });
        });
      }
    }

    return loader;
  }

  // Fallback: ESM imports
  if (esm && esm.GLTFLoader) {
    const GLTFLoader = esm.GLTFLoader.GLTFLoader || esm.GLTFLoader;
    const loader = new GLTFLoader();
    if (esm.THREE_VRM) {
      const { MToonMaterialLoaderPlugin, VRMLoaderPlugin } = esm.THREE_VRM;
      const MToonNodeMaterial = esm.THREE_VRM.nodes?.MToonNodeMaterial || null;
      loader.register((parser) => {
        const mtoonMaterialPlugin = new MToonMaterialLoaderPlugin(parser, { materialType: MToonNodeMaterial });
        return new VRMLoaderPlugin(parser, { mtoonMaterialPlugin });
      });
    }
    return loader;
  }

  throw new Error('Unable to create a VRM-aware GLTFLoader (no suitable THREE/GLTFLoader found)');
}

export async function loadVRMFromUrl(url) {
  const loader = await createVRMAwareGLTFLoader();
  return await new Promise((resolve, reject) => {
    loader.load(url, async (gltf) => {
      try {
        // If global pixiv conversion function exists
        if (window.THREE_VRM && window.THREE_VRM.VRM) {
          try {
            const vrm = await window.THREE_VRM.VRM.from(gltf);
            resolve(vrm);
            return;
          } catch (e) {
            console.warn('VRM.from failed, returning raw gltf scene');
          }
        }

        // Some loader plugins attach vrm to userData
        if (gltf.userData && gltf.userData.vrm) {
          resolve(gltf.userData.vrm);
          return;
        }

        resolve({ scene: gltf.scene, animations: gltf.animations || [] });
      } catch (err) {
        reject(err);
      }
    }, undefined, reject);
  });
}
