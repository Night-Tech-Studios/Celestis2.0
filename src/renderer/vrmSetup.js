// This module tries to support two environments:
// 1) Renderer with global UMD `THREE` and `THREE_VRM` loaded (via CDN/UMD). Prefer this.
// 2) ESM-capable environment where the app can import from node_modules (rare in plain index.html).
// The helper below will prefer globals and only attempt dynamic ESM imports as fallback.

async function ensureEsmModules() {
  // Attempt no-op: in renderer we prefer global UMD objects already present
  if (typeof window !== 'undefined' && window.THREE && window.THREE_VRM) {
    return { THREE: window.THREE, THREE_VRM: window.THREE_VRM };
  }

  // Try dynamic ESM imports relative to this file (best-effort). These paths work if node_modules exist
  try {
    const { GLTFLoader } = await import('../node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const three = await import('../node_modules/three/build/three.module.js');
    const vrm = await import('../node_modules/@pixiv/three-vrm/dist/three-vrm.module.js');
    return { THREE: three, THREE_VRM: vrm, GLTFLoader };
  } catch (e) {
    console.warn('[vrmSetup] ESM dynamic import failed:', e.message || e);
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
