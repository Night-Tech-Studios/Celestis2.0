(async function main() {
	console.log('[three-modules.js] Starting ES module imports...');

	// Use dynamic import so the script can run in contexts where top-level static imports cause issues.
	let THREE_NS;
	try {
		THREE_NS = await import('../node_modules/three/build/three.module.js');
		console.log('[three-modules.js] THREE imported');
	} catch (e) {
		console.warn('[three-modules.js] Failed to dynamically import three.module.js:', e && e.message);
		// fallback to empty namespace to avoid runtime crashes; real functionality may be limited.
		THREE_NS = {};
	}

	// Attach to window for the rest of the app which expects global THREE
	window.THREE = window.THREE || {};
	Object.assign(window.THREE, THREE_NS);
	// Helper: load a jsm loader module from provided source text by creating a module blob
	// and rewriting the bare 'three' import to point at a blob URL for three.module.js.
	async function importJsmFromSources(threeSource, loaderSource) {
		if (!loaderSource) return null;
		// If we have a threeSource, prefer to create a blob URL for it and rewrite imports
		if (threeSource) {
			const threeBlob = new Blob([threeSource], { type: 'text/javascript' });
			const threeUrl = URL.createObjectURL(threeBlob);
			try {
				// Replace import specifiers in loaderSource that import from 'three'
				const rewritten = loaderSource.replace(/from\s+['"]three['"]/g, `from '${threeUrl}'`);
				const loaderBlob = new Blob([rewritten], { type: 'text/javascript' });
				const loaderUrl = URL.createObjectURL(loaderBlob);
				try {
					const mod = await import(loaderUrl);
					// cleanup
					URL.revokeObjectURL(loaderUrl);
					URL.revokeObjectURL(threeUrl);
					return mod;
				} catch (e) {
					URL.revokeObjectURL(loaderUrl);
					URL.revokeObjectURL(threeUrl);
					throw e;
				}
			} catch (e) {
				try { URL.revokeObjectURL(threeUrl); } catch (_){ }
				throw e;
			}
		}

		// If no threeSource available but runtime has window.THREE, rewrite imports to use window.THREE
		if (typeof window !== 'undefined' && window.THREE) {
			try {
				let rewritten = loaderSource;
				// Replace `import * as THREE from 'three';` -> `const THREE = window.THREE;`
				rewritten = rewritten.replace(/import\s+\*\s+as\s+THREE\s+from\s+['"]three['"];/g, 'const THREE = window.THREE;');
				// Replace named imports: import { A, B } from 'three'; -> const {A, B} = window.THREE;
				rewritten = rewritten.replace(/import\s+\{([^}]*)\}\s+from\s+['"]three['"];/g, (m, p1) => {
					return 'const {' + p1 + '} = window.THREE;';
				});
				// Replace default import patterns (rare) -> const THREE = window.THREE;
				rewritten = rewritten.replace(/import\s+THREE\s+from\s+['"]three['"];/g, 'const THREE = window.THREE;');
				const loaderBlob = new Blob([rewritten], { type: 'text/javascript' });
				const loaderUrl = URL.createObjectURL(loaderBlob);
				try {
					const mod = await import(loaderUrl);
					URL.revokeObjectURL(loaderUrl);
					return mod;
				} catch (e) {
					URL.revokeObjectURL(loaderUrl);
					throw e;
				}
			} catch (e) {
				throw e;
			}
		}

		return null;
	}
	console.log('[three-modules.js] THREE loaded:', !!window.THREE);
	console.log('[three-modules.js] THREE.REVISION:', window.THREE.REVISION);

	// Flag to indicate module-based loaders are ready
	window.__threeModulesLoaded = true;

	// Signal ready
	console.log('[three-modules.js] Dispatching threejs-ready event');
	window.dispatchEvent(new CustomEvent('threejs-ready'));

	// Ensure GLTFLoader is available in renderer: prefer node_modules (jsm) imports and examples/js files.
	(async function ensureGLTFLoader() {
		try {
			// single ESM detection pattern for this function
			const esmPattern = /^\s*(?:import|export)\b|from\s+['"]three['"]/m;
			if (window.THREE && window.THREE.GLTFLoader) {
				console.log('[three-modules.js] GLTFLoader already present');
				return;
			}

			// 1) Prefer ESM jsm sources provided by preload (loaderJsm) -- import via blob after rewriting 'three'
			try {
				if (window.celestis && window.celestis.threeModuleSource && window.celestis.loaderJsm && window.celestis.loaderJsm.gltf) {
					console.log('[three-modules.js] Attempting to import GLTFLoader from preload-provided jsm sources via blob');
					try {
						const mod = await importJsmFromSources(window.celestis.threeModuleSource, window.celestis.loaderJsm.gltf);
						const GLTFLoader = (mod && (mod.GLTFLoader || mod.default || mod));
						if (GLTFLoader) {
							window.THREE = window.THREE || {};
							window.THREE.GLTFLoader = GLTFLoader;
							console.log('[three-modules.js] Attached GLTFLoader via preload jsm blob import');
							return;
						}
					} catch (e) {
						console.log('[three-modules.js] preload jsm blob import failed:', e && e.message);
					}
				}
			} catch (e) { console.warn('[three-modules.js] error checking preload-provided loaderJsm:', e && e.message); }

			// 2) If preload provided examples/js (UMD) content, inject it as a classic script (only if it's not ESM)
			try {
				if (window.celestis && window.celestis.loaderJs && window.celestis.loaderJs.gltf) {
					const txt = window.celestis.loaderJs.gltf || '';
					// More strict ESM detection: checks for import/export at line start or a bare 'from "three"' usage
					const looksLikeEsm = esmPattern.test(txt);
					if (looksLikeEsm) {
						// Try blob-import even if threeModuleSource is missing by letting importJsmFromSources
						// rewrite the loader source to reference the runtime window.THREE object.
						try {
							const mod = await importJsmFromSources(window.celestis && window.celestis.threeModuleSource ? window.celestis.threeModuleSource : null, txt);
							const GLTFLoader = (mod && (mod.GLTFLoader || mod.default || mod));
							if (GLTFLoader) {
								window.THREE = window.THREE || {};
								window.THREE.GLTFLoader = GLTFLoader;
								console.log('[three-modules.js] Attached GLTFLoader via preload-provided ESM blob import (using runtime THREE fallback)');
								return;
							}
						} catch (e) {
							console.warn('[three-modules.js] preload-provided ESM blob import failed:', e && e.message);
						}
					} else {
						// UMD/classic script content — inject as-is
						try {
							console.log('[three-modules.js] Injecting GLTFLoader from preload-provided examples/js (UMD) content');
							const s = document.createElement('script');
							s.type = 'text/javascript';
							s.text = txt;
							document.head.appendChild(s);
							if (window.THREE && window.THREE.GLTFLoader) { console.log('[three-modules.js] GLTFLoader attached after preload-provided injection'); return; }
						} catch (e) {
							console.warn('[three-modules.js] preload-provided GLTFLoader injection failed:', e && e.message);
						}
					}
				}
			} catch (e) { console.warn('[three-modules.js] error checking preload-provided loaderJs:', e && e.message); }

			// 3) Prefer in-project jsm copy under src/modules/jsm/loaders if present — fetch and import via blob
			try {
				// Resolve the in-project GLTFLoader relative to this module file so paths work the same in dev and packaged builds
				const localJsmUrl = new URL('./modules/jsm/loaders/GLTFLoader.js', import.meta.url).href;
				console.log('[three-modules.js] Trying in-project jsm GLTFLoader at', localJsmUrl);
				const rl = await fetch(localJsmUrl);
				if (rl.ok) {
					const txtl = await rl.text();
					const looksLikeEsmLocal = esmPattern.test(txtl);
					if (looksLikeEsmLocal) {
						// Try blob-import even without a threeModuleSource by falling back to runtime window.THREE
						try {
							const mod = await importJsmFromSources(window.celestis && window.celestis.threeModuleSource ? window.celestis.threeModuleSource : null, txtl);
							const GLTFLoader = (mod && (mod.GLTFLoader || mod.default || mod));
							if (GLTFLoader) {
								window.THREE = window.THREE || {};
								window.THREE.GLTFLoader = GLTFLoader;
								console.log('[three-modules.js] Attached GLTFLoader via in-project ESM blob import (using runtime THREE fallback)');
								return;
							}
						} catch (e) {
							console.log('[three-modules.js] in-project jsm blob import failed:', e && e.message);
						}
					} else {
						// non-ESM (unlikely for jsm), inject directly
						try {
							const s = document.createElement('script');
							s.type = 'text/javascript';
							s.text = txtl;
							document.head.appendChild(s);
							if (window.THREE && window.THREE.GLTFLoader) { console.log('[three-modules.js] GLTFLoader attached after in-project injection'); return; }
						} catch (e) { console.warn('[three-modules.js] in-project GLTFLoader injection failed:', e && e.message); }
					}
				} else {
					console.log('[three-modules.js] in-project jsm GLTFLoader not found at', localJsmUrl, 'status:', rl.status);
				}
			} catch (e) {
				console.log('[three-modules.js] fetch in-project jsm GLTFLoader failed:', e && e.message);
			}

			// 4) Try fetching jsm from node_modules and import via blob if it's ESM; otherwise try UMD path.
			try {
				const jsmPath = '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
				console.log('[three-modules.js] Trying to fetch jsm GLTFLoader at', jsmPath);
				const r = await fetch(jsmPath);
				if (r.ok) {
					const txt = await r.text();
					const looksLikeEsm = esmPattern.test(txt);
					if (looksLikeEsm) {
						// Try blob-import even without threeModuleSource by rewriting imports to use window.THREE
						try {
							const mod = await importJsmFromSources(window.celestis && window.celestis.threeModuleSource ? window.celestis.threeModuleSource : null, txt);
							const GLTFLoader = (mod && (mod.GLTFLoader || mod.default || mod));
							if (GLTFLoader) {
								window.THREE = window.THREE || {};
								window.THREE.GLTFLoader = GLTFLoader;
								console.log('[three-modules.js] Attached GLTFLoader via fetched ESM blob import (using runtime THREE fallback)');
								return;
							}
						} catch (e) {
							console.log('[three-modules.js] fetched jsm blob import failed:', e && e.message);
						}
					} else {
						// If fetched file isn't ESM, inject directly
						try {
							const s = document.createElement('script');
							s.type = 'text/javascript';
							s.text = txt;
							document.head.appendChild(s);
							console.log('[three-modules.js] Injected GLTFLoader from fetched jsm (non-ESM)');
							if (window.THREE && window.THREE.GLTFLoader) { return; }
						} catch (e) { console.warn('[three-modules.js] injecting fetched jsm non-esm failed:', e && e.message); }
					}
				} else {
					console.log('[three-modules.js] jsm GLTFLoader not found at', jsmPath, 'status:', r.status);
				}
			} catch (e) {
				console.log('[three-modules.js] fetch jsm GLTFLoader failed:', e && e.message);
			}

			// 5) Finally, try the UMD examples/js path from node_modules
			try {
				// prefer the real examples/js (UMD) path (not jsm)
				const umdPath = '../node_modules/three/examples/js/loaders/GLTFLoader.js';
				console.log('[three-modules.js] Trying node_modules examples/js (UMD) GLTFLoader at', umdPath);
				const r2 = await fetch(umdPath);
				if (r2.ok) {
					const txt2 = await r2.text();
					const looksLikeEsm2 = esmPattern.test(txt2);
					if (looksLikeEsm2) {
						// Try blob-import even without threeModuleSource by rewriting imports to use window.THREE
						try {
							const mod = await importJsmFromSources(window.celestis && window.celestis.threeModuleSource ? window.celestis.threeModuleSource : null, txt2);
							const GLTFLoader = (mod && (mod.GLTFLoader || mod.default || mod));
							if (GLTFLoader) {
								window.THREE = window.THREE || {};
								window.THREE.GLTFLoader = GLTFLoader;
								console.log('[three-modules.js] Attached GLTFLoader via node_modules ESM blob import (using runtime THREE fallback)');
								return;
							}
						} catch (e) {
							console.warn('[three-modules.js] node_modules ESM blob import failed:', e && e.message);
						}
					} else {
						// Looks like UMD/classic script — inject safely
						try {
							const s2 = document.createElement('script');
							s2.type = 'text/javascript';
							s2.text = txt2;
							document.head.appendChild(s2);
							console.log('[three-modules.js] Injected GLTFLoader from node_modules examples/js (UMD)');
							if (window.THREE && window.THREE.GLTFLoader) { console.log('[three-modules.js] GLTFLoader attached after node_modules UMD injection'); return; }
						} catch (e) { console.warn('[three-modules.js] node_modules UMD injection failed:', e && e.message); }
					}
				} else {
					console.log('[three-modules.js] node_modules examples/js GLTFLoader not found, status:', r2.status);
				}
			} catch (e) {
				console.log('[three-modules.js] node_modules examples/js GLTFLoader fetch failed:', e && e.message);
			}

			// FBX support removed — intentionally skip FBX loader attempts

			console.warn('[three-modules.js] GLTFLoader not available after node_modules attempts');
		} catch (e) {
			console.warn('[three-modules.js] ensureGLTFLoader error:', e && e.message);
		}

	})();
})();
