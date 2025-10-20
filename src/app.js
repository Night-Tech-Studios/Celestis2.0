// Use the safe IPC surface exposed by preload (contextBridge)
const ipc = (window && window.electronAPI) ? window.electronAPI : {
        invoke: async () => { throw new Error('IPC not available'); },
        send: () => {},
        on: () => {}
};

// Debug logging function
function debugLog(message) {
        console.log('[APP]', message);
        try {
                ipc.send('debug-log', message);
        } catch (e) {
                // Ignore if IPC not available
        }
}

class CelestisAI {
        constructor() {
                this.scene = null;
                this.camera = null;
                this.renderer = null;
                this.vrm = null;
                this.mixer = null;
                this.clock = null;
                this.isRecording = false;
                this.recognition = null;
                this.settings = {
                        openrouterApiKey: '',
                        aiModel: 'meta-llama/llama-4-maverick:free',
                        voiceLanguage: 'en-US',
                        rendererEngine: 'three',
                        rendererTimeoutMs: 15000,
                        initialTemplate: 'You are a helpful AI assistant in a VRM avatar application. Be friendly and engaging.'
                };
                
                this.conversationHistory = [];
                debugLog('CelestisAI constructor called');
                this.initWithDelay();
        }

        initWithDelay() {
                const self = this;
                (async function() {
                        try {
                                await self.waitForThreeAndLoaders();
                                await self.init();
                        } catch (e) {
                                const msg = (e && e.message) ? e.message : String(e);
                                debugLog('Three.js/Loaders wait failed: ' + msg);

                                // If it was a timeout, fall back to 2D renderer gracefully
                                if (msg && msg.toLowerCase().includes('timeout')) {
                                        debugLog('Three.js readiness timed out - switching to 2D renderer fallback');
                                        try {
                                                self.settings.previousRenderer = self.settings.rendererEngine;
                                                self.settings.rendererEngine = '2d';
                                                await self.setup2DEngine();
                                                await self.init();
                                                return;
                                        } catch (err) {
                                                debugLog('Error initializing 2D fallback after timeout: ' + (err?.message || err));
                                                self.initFallback();
                                                return;
                                        }
                                }

                                // Non-timeout path: try partial init if THREE is present
                                if (typeof THREE !== 'undefined' && THREE.WebGLRenderer) {
                                        debugLog('THREE renderer available - proceeding with partial init and deferring loader failures until import time');
                                        self._threeModulesPartial = true;
                                        try {
                                                await self.init();
                                        } catch (innerErr) {
                                                debugLog('Error during partial init: ' + (innerErr?.message || innerErr));
                                                self.initFallback();
                                        }
                                } else {
                                        // No THREE at all - do full fallback
                                        self.initFallback();
                                }
                        }
                })();
        }

        waitForThreeAndLoaders() {
                const self = this;
                return new Promise((resolve, reject) => {
                        self.updateAvatarStatus('Initializing 3D engine...');

                        const timeoutMs = (self.settings && typeof self.settings.rendererTimeoutMs === 'number') ? self.settings.rendererTimeoutMs : 15000;

                        // Quick-pass: if THREE and renderer available, resolve immediately
                        const moduleReady = () => !!(window.__threeModulesLoaded || (typeof THREE !== 'undefined' && THREE.WebGLRenderer));
                        if (moduleReady()) {
                                resolve();
                                return;
                        }

                        let settled = false;
                        let timeoutId = null;

                        const cleanup = () => {
                                try { window.removeEventListener('threejs-ready', onReady); } catch (_) {}
                                try { clearInterval(pollId); } catch (_) {}
                                try { if (timeoutId) clearTimeout(timeoutId); } catch (_) {}
                        };

                        const onReady = () => {
                                if (settled) return;
                                settled = true;
                                cleanup();
                                resolve();
                        };

                        window.addEventListener('threejs-ready', onReady, { once: true });

                        // Poll for THREE availability as well in case event was missed
                        const pollId = setInterval(() => {
                                if (moduleReady()) {
                                        onReady();
                                }
                        }, 150);

                        // Timeout path - reject so caller can decide fallback
                        timeoutId = setTimeout(() => {
                                if (settled) return;
                                settled = true;
                                cleanup();
                                reject(new Error('Timeout waiting for THREE/Loaders'));
                        }, timeoutMs);
                });
        }

        init() {
                const self = this;
                return (async function() {
                        debugLog('Initializing CelestisAI...');
                        self.updateAvatarStatus('Initializing application...');
                        
                        self.setupEventListeners();
                        self.loadInternalAvatars();
                        
                        // Choose renderer based on settings: 'three' or '2d'
                        // Renderer selection is locked to 2D for now.
                        // 3D support remains in the codebase as WIP for future repair. Do not remove.
                        /* WIP: Three.js 3D renderer setup (disabled)
                        const engine = (self.settings && self.settings.rendererEngine) ? self.settings.rendererEngine : 'three';
                        debugLog('Selected renderer engine: ' + engine);
                        if (engine === 'three' && typeof THREE !== 'undefined') {
                                debugLog('Three.js is available, setting up 3D engine');
                                self.updateAvatarStatus('Setting up 3D engine...');
                                try {
                                        self.clock = new THREE.Clock();
                                        self.setupThreeJS();
                                        self.animate();
                                        self.updateAvatarStatus('3D engine ready - Import VRM to load avatar');
                                } catch (error) {
                                        debugLog('Error setting up Three.js: ' + error.message);
                                        self.updateAvatarStatus('3D engine error - using fallback mode');
                                        self.setupFallbackDisplay();
                                }
                        } else {
                                // Fallback to lightweight 2D engine
                                debugLog('Using 2D canvas renderer');
                                self.updateAvatarStatus('Setting up 2D engine...');
                                try {
                                        self.setup2DEngine();
                                        self.updateAvatarStatus('2D engine ready');
                                } catch (error) {
                                        debugLog('Error setting up 2D engine: ' + error.message);
                                        self.updateAvatarStatus('2D engine error - using fallback mode');
                                        self.setupFallbackDisplay();
                                }
                        }
                        */

                        // Enforce 2D engine for now
                        debugLog('Enforcing 2D canvas renderer (3D is WIP)');
                        self.updateAvatarStatus('Setting up 2D engine...');
                        try { self.setup2DEngine(); self.updateAvatarStatus('2D engine ready'); } catch(e){ debugLog('2D setup failed: '+(e?.message||e)); self.setupFallbackDisplay(); }
                        
                        self.setupSpeechRecognition();
                        await self.loadSettings();
                        
                        debugLog('CelestisAI initialized successfully');
                })();
        }
        
        initFallback() {
                debugLog('Initializing with fallback mode...');
                this.updateAvatarStatus('3D engine not available - using fallback mode');
                this.setupEventListeners();
                this.setupSpeechRecognition();
                this.loadSettings();
                this.setupFallbackDisplay();
                debugLog('Fallback initialization completed');
        }

        _removeFallbackPlaceholders() {
                try {
                        if (!this.scene) return;
                        const toRemove = [];
                        this.scene.traverse((child) => {
                                if (!child) return;
                                const name = (child.name || '').toLowerCase();
                                if (!name) return;
                                // Known placeholder names
                                if (name.includes('fbx_empty') || name.includes('fallback') || name.includes('placeholder') || name.startsWith('primitive_') || name.includes('empty')) {
                                        toRemove.push(child);
                                }
                        });
                        toRemove.forEach(obj => {
                                if (obj.parent) obj.parent.remove(obj);
                                debugLog('[removeFallback] Removed placeholder: ' + (obj.name || obj.type || 'unnamed'));
                        });
                } catch (e) {
                        debugLog('[removeFallback] Error removing placeholders: ' + (e?.message || e));
                }
        }

        setupThreeJS() {
                debugLog('Setting up Three.js scene...');
                const canvas = document.getElementById('avatarCanvas');
                
                if (!canvas) {
                        throw new Error('Avatar canvas not found');
                }

                if (!THREE.Scene || !THREE.PerspectiveCamera || !THREE.WebGLRenderer) {
                        throw new Error('Essential Three.js classes not available');
                }

                this.scene = new THREE.Scene();
                this.scene.background = null;
                debugLog('✓ Scene created');

                this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
                this.camera.position.set(2, 1.5, 4);
                debugLog('✓ Camera created');

                this.renderer = new THREE.WebGLRenderer({ 
                        canvas: canvas,
                        antialias: true,
                        alpha: true,
                        precision: 'highp'
                });
                this.renderer.setSize(window.innerWidth, window.innerHeight);
                this.renderer.setPixelRatio(window.devicePixelRatio);
                this.renderer.shadowMap.enabled = true;
                this.renderer.shadowMap.type = THREE.PCFShadowMap;
                this.renderer.setClearColor(0x000000, 0);
                debugLog('✓ Renderer created and added to DOM');

                this.setupCameraControls();

                const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
                this.scene.add(ambientLight);

                const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
                directionalLight.position.set(2, 3, 2);
                directionalLight.castShadow = true;
                directionalLight.shadow.mapSize.width = 4096;
                directionalLight.shadow.mapSize.height = 4096;
                directionalLight.shadow.camera.near = 0.1;
                directionalLight.shadow.camera.far = 50;
                directionalLight.shadow.bias = -0.0001;
                this.scene.add(directionalLight);
                
                const rimLight = new THREE.DirectionalLight(0x6667ea, 0.8);
                rimLight.position.set(-2, 1, -1);
                this.scene.add(rimLight);
                debugLog('✓ Enhanced lighting added');

                this.createBackgroundParticles();

                window.addEventListener('resize', () => {
                        this.camera.aspect = window.innerWidth / window.innerHeight;
                        this.camera.updateProjectionMatrix();
                        this.renderer.setSize(window.innerWidth, window.innerHeight);
                });

                debugLog('Three.js setup completed successfully');
        }

        // Simple 2D renderer useful as a fallback or lightweight option
        setup2DEngine() {
                debugLog('Setting up 2D canvas engine...');
                const canvas = document.getElementById('avatarCanvas');
                if (!canvas) throw new Error('Avatar canvas not found for 2D engine');
                // Ensure it's a 2D context
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('2D context not available');
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
                this._2d = { ctx, canvas, t: 0, image: null };

                window.addEventListener('resize', () => {
                        this._2d.canvas.width = window.innerWidth;
                        this._2d.canvas.height = window.innerHeight;
                });

                // Start a simple draw loop
                const loop = () => {
                        try {
                                const d = this._2d;
                                d.t += 0.016;
                                const ctx = d.ctx;
                                const w = d.canvas.width;
                                const h = d.canvas.height;
                                // background
                                ctx.fillStyle = '#0b72b9';
                                ctx.fillRect(0, 0, w, h);

                                // If an image is loaded, draw it centered and scaled; otherwise draw placeholder avatar
                                if (d.image) {
                                        try {
                                                const img = d.image;
                                                const maxW = w * 0.6;
                                                const maxH = h * 0.7;
                                                let iw = img.width, ih = img.height;
                                                const ratio = Math.min(maxW / iw, maxH / ih, 1);
                                                iw = iw * ratio; ih = ih * ratio;
                                                const x = (w - iw) / 2;
                                                const y = (h - ih) / 2;
                                                ctx.drawImage(img, x, y, iw, ih);
                                        } catch (e) {
                                                debugLog('Error drawing 2D image in loop: ' + (e?.message || e));
                                        }
                                } else {
                                        // animated circle as placeholder avatar
                                        const cx = w / 2;
                                        const cy = h / 2;
                                        const r = Math.min(w, h) * 0.18;
                                        const pulse = Math.sin(d.t * 2) * 0.05 + 0.95;
                                        ctx.beginPath();
                                        ctx.fillStyle = 'rgba(255,255,255,0.95)';
                                        ctx.arc(cx, cy - r * 0.1, r * pulse, 0, Math.PI * 2);
                                        ctx.fill();
                                        // eyes
                                        ctx.fillStyle = '#222';
                                        ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.15, r * 0.08, 0, Math.PI * 2); ctx.fill();
                                        ctx.beginPath(); ctx.arc(cx + r * 0.35, cy - r * 0.15, r * 0.08, 0, Math.PI * 2); ctx.fill();
                                        // mouth
                                        ctx.strokeStyle = '#222'; ctx.lineWidth = Math.max(2, r * 0.04);
                                        ctx.beginPath(); ctx.arc(cx, cy + r * 0.1, r * 0.35, 0, Math.PI); ctx.stroke();
                                }
                        } catch (e) {
                                debugLog('2D loop error: ' + (e?.message || e));
                        }
                        this._2d._raf = requestAnimationFrame(loop);
                };
                loop();
                debugLog('2D engine loop started');

                // Try to load a default 2D avatar image from internal avatars (default-2d.png or default.png)
                try { this.loadDefault2DAvatar(); } catch (e) { /* non-fatal */ }
        }

        createBackgroundParticles() {
                try {
                        const particleCount = 50;
                        const particles = new THREE.Group();
                        particles.name = 'BackgroundParticles';

                        for (let i = 0; i < particleCount; i++) {
                                const particleGeometry = new THREE.SphereGeometry(0.02, 4, 4);
                                const particleMaterial = new THREE.MeshBasicMaterial({ 
                                        color: 0xffffff,
                                        transparent: true,
                                        opacity: 0.1 + Math.random() * 0.2
                                });
                                
                                const particle = new THREE.Mesh(particleGeometry, particleMaterial);
                                
                                particle.position.set(
                                        (Math.random() - 0.5) * 20,
                                        Math.random() * 10,
                                        (Math.random() - 0.5) * 20
                                );
                                
                                particles.add(particle);
                        }

                        this.scene.add(particles);
                        this.backgroundParticles = particles;
                        debugLog('✓ Background particles created');
                } catch (error) {
                        debugLog('Error creating background particles: ' + error.message);
                }
        }

        setupFallbackDisplay() {
                debugLog('Setting up fallback display...');
                const canvas = document.getElementById('avatarCanvas');
                
                if (!canvas) {
                        debugLog('ERROR: Avatar canvas not found for fallback!');
                        return;
                }

                const fallbackDiv = document.createElement('div');
                fallbackDiv.id = 'fallbackDisplay';
                fallbackDiv.style.cssText = `
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100vw;
                        height: 100vh;
                        z-index: -2;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-family: Arial, sans-serif;
                        text-align: center;
                `;
                
                fallbackDiv.innerHTML = `
                        <div style="font-size: 48px; margin-bottom: 20px; opacity: 0.3;">🤖</div>
                        <div style="font-size: 20px; margin-bottom: 10px; opacity: 0.5;">Celestis AI Avatar</div>
                        <div style="font-size: 16px; color: rgba(255,255,255,0.7); margin-bottom: 20px;">Ready for Chat</div>
                        <div style="font-size: 12px; color: rgba(255,255,255,0.5);">VRM loading available when 3D engine is ready</div>
                `;
                
                document.body.appendChild(fallbackDiv);
                this.updateAvatarStatus('Fallback mode active - Chat functionality available');
                debugLog('Fallback display created');
        }

        setupCameraControls() {
                let mouseDown = false;
                let mouseX = 0;
                let mouseY = 0;

                this.renderer.domElement.addEventListener('mousedown', (event) => {
                        mouseDown = true;
                        mouseX = event.clientX;
                        mouseY = event.clientY;
                });

                this.renderer.domElement.addEventListener('mouseup', () => {
                        mouseDown = false;
                });

                this.renderer.domElement.addEventListener('mousemove', (event) => {
                        if (!mouseDown) return;

                        const deltaX = event.clientX - mouseX;
                        const deltaY = event.clientY - mouseY;

                        const spherical = new THREE.Spherical();
                        spherical.setFromVector3(this.camera.position);
                        spherical.theta -= deltaX * 0.01;
                        spherical.phi += deltaY * 0.01;
                        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));

                        this.camera.position.setFromSpherical(spherical);
                        this.camera.lookAt(0, 1, 0);

                        mouseX = event.clientX;
                        mouseY = event.clientY;
                });

                this.renderer.domElement.addEventListener('wheel', (event) => {
                        const distance = this.camera.position.length();
                        const newDistance = distance + event.deltaY * 0.01;
                        if (newDistance > 1 && newDistance < 10) {
                                this.camera.position.normalize().multiplyScalar(newDistance);
                        }
                        event.preventDefault();
                });
        }

        setupEventListeners() {
                debugLog('Setting up event listeners...');
                this.bindEvents();
                this.setupIPC();
        }

        bindEvents() {
                debugLog('Binding button events...');

                const clearChatBtn = document.getElementById('clearChatBtn');
                if (clearChatBtn) {
                        clearChatBtn.addEventListener('click', (e) => {
                                e.preventDefault();
                                debugLog('Clear chat button clicked!');
                                this.clearConversation();
                        });
                        debugLog('✓ Clear chat button bound');
                } else {
                        debugLog('✗ Clear chat button not found');
                }

                const settingsBtn = document.getElementById('settingsBtn');
                if (settingsBtn) {
                        settingsBtn.addEventListener('click', (e) => {
                                e.preventDefault();
                                debugLog('Settings button clicked!');
                                this.openSettings();
                        });
                        debugLog('✓ Settings button bound');
                } else {
                        debugLog('✗ Settings button not found');
                }

                const importVrmBtn = document.getElementById('importVrmBtn');
                if (importVrmBtn) {
                        importVrmBtn.addEventListener('click', (e) => {
                                e.preventDefault();
                                debugLog('Import VRM button clicked!');
                                this.importVRM();
                        });
                        debugLog('✓ Import VRM button bound');
                } else {
                        debugLog('✗ Import VRM button not found');
                }

                const internalSelect = document.getElementById('internalAvatarSelect');
                if (internalSelect) {
                        internalSelect.addEventListener('change', async (e) => {
                                const fileName = e.target.value;
                                if (!fileName) return;
                                try {
                                        debugLog('Loading internal avatar: ' + fileName);
                                        const buffer = await ipc.invoke('read-internal-avatar', fileName);
                                        // Prefer VRM/GLTF loading for internal avatars
                                        await this.loadVRMFromBuffer(buffer, fileName);
                                        // Also ask main to forward buffer to preview window (send a transferable copy)
                                        try {
                                                ipc.send('forward-to-preview', buffer, fileName);
                                        } catch(err){ debugLog('Failed to request preview load: ' + (err?.message||err)); }
                                } catch (err) {
                                        debugLog('Error loading internal avatar: ' + (err?.message || err));
                                        this.updateAvatarStatus('Failed to load internal avatar');
                                }
                        });
                        debugLog('✓ Internal avatar selector bound');
                }

                const sendBtn = document.getElementById('sendBtn');
                if (sendBtn) {
                        sendBtn.addEventListener('click', (e) => {
                                e.preventDefault();
                                debugLog('Send button clicked!');
                                this.sendMessage();
                        });
                        debugLog('✓ Send button bound');
                } else {
                        debugLog('✗ Send button not found');
                }

                const textInput = document.getElementById('textInput');
                if (textInput) {
                        textInput.addEventListener('keypress', (e) => {
                                if (e.key === 'Enter') {
                                        e.preventDefault();
                                        this.sendMessage();
                                }
                        });
                        debugLog('✓ Text input bound');
                } else {
                        debugLog('✗ Text input not found');
                }

                const micBtn = document.getElementById('micBtn');
                if (micBtn) {
                        micBtn.addEventListener('click', (e) => {
                                e.preventDefault();
                                debugLog('Mic button clicked!');
                                this.toggleVoiceRecording();
                        });
                        debugLog('✓ Mic button bound');
                } else {
                        debugLog('✗ Mic button not found');
                }

                const closeSettingsBtn = document.getElementById('closeSettingsBtn');
                if (closeSettingsBtn) {
                        closeSettingsBtn.addEventListener('click', (e) => {
                                e.preventDefault();
                                debugLog('Close settings clicked!');
                                this.closeSettings();
                        });
                        debugLog('✓ Close settings button bound');
                } else {
                        debugLog('✗ Close settings button not found');
                }

                const saveSettingsBtn = document.getElementById('saveSettingsBtn');
                if (saveSettingsBtn) {
                        saveSettingsBtn.addEventListener('click', (e) => {
                                e.preventDefault();
                                debugLog('Save settings clicked!');
                                this.saveSettings();
                        });
                        debugLog('✓ Save settings button bound');
                } else {
                        debugLog('✗ Save settings button not found');
                }

                const settingsModal = document.getElementById('settingsModal');
                if (settingsModal) {
                        settingsModal.addEventListener('click', (e) => {
                                if (e.target === settingsModal) {
                                        this.closeSettings();
                                }
                        });
                        debugLog('✓ Settings modal bound');
                } else {
                        debugLog('✗ Settings modal not found');
                }

                debugLog('Event binding completed');
        }

        setupIPC() {
                debugLog('Setting up IPC listeners...');
                
                ipc.on('vrm-selected', (_event, filePath) => {
                        debugLog('VRM file selected via IPC: ' + filePath);
                        this.loadVRM(filePath);
                });

                // Listen for a reply from main that preview loaded internal avatar
                ipc.on('preview-loaded', (_e, info) => {
                        debugLog('Preview loaded: ' + JSON.stringify(info));
                });

                ipc.on('open-settings', () => {
                        debugLog('Open settings via IPC');
                        this.openSettings();
                });

                debugLog('IPC listeners set up');
        }

        async loadInternalAvatars() {
                try {
                        const list = await ipc.invoke('list-internal-avatars');
                        const select = document.getElementById('internalAvatarSelect');
                        if (!select) return;
                        select.innerHTML = '<option value="">Internal Avatars...</option>';
                        list.forEach(item => {
                                const opt = document.createElement('option');
                                opt.value = item.name;
                                opt.textContent = item.name;
                                select.appendChild(opt);
                        });
                        debugLog('Loaded internal avatars: ' + list.length);
                } catch (e) {
                        debugLog('Failed to load internal avatars: ' + (e?.message || e));
                }
        }

        setupSpeechRecognition() {
                if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                        this.recognition = new SpeechRecognition();
                        this.recognition.continuous = false;
                        this.recognition.interimResults = false;
                        this.recognition.lang = this.settings.voiceLanguage;

                        this.recognition.onstart = () => {
                                this.updateVoiceStatus('Listening...');
                        };

                        this.recognition.onresult = (event) => {
                                const transcript = event.results[0][0].transcript;
                                const textInput = document.getElementById('textInput');
                                if (textInput) {
                                        textInput.value = transcript;
                                }
                                this.updateVoiceStatus('Voice input received');
                                setTimeout(() => this.updateVoiceStatus(''), 2000);
                        };

                        this.recognition.onerror = (event) => {
                                this.updateVoiceStatus('Voice recognition error: ' + event.error);
                                setTimeout(() => this.updateVoiceStatus(''), 3000);
                        };

                        this.recognition.onend = () => {
                                this.isRecording = false;
                                const micBtn = document.getElementById('micBtn');
                                if (micBtn) {
                                        micBtn.classList.remove('recording');
                                }
                                this.updateVoiceStatus('');
                        };

                        debugLog('Speech recognition setup completed');
                } else {
                        debugLog('Speech recognition not supported');
                }
        }

        async loadVRM(filePath) {
                try {
                        debugLog('Starting VRM model load for: ' + filePath);
                        this.updateAvatarStatus('Loading Avatar...');
                        // Remove any known placeholder/fallback objects so the real model can appear
                        this._removeFallbackPlaceholders();
                        
                        if (!this.scene) {
                                debugLog('No 3D scene available, cannot load VRM model');
                                this.updateAvatarStatus('3D engine not ready - cannot load VRM model');
                                return;
                        }
                        
                        const buffer = await ipc.invoke('read-vrm-file', filePath);
                        debugLog('VRM buffer received, size: ' + buffer.length);

                        await this.loadVRMFromBuffer(buffer, filePath);
                        // forward to preview window as well
                        try {
                                ipc.send('forward-to-preview', buffer, (filePath||'avatar').split(/[\\\/]/).pop());
                        } catch(e){ debugLog('Failed to forward to preview: ' + (e?.message||e)); }
                        
                } catch (error) {
                        debugLog('ERROR loading VRM: ' + (error?.message || error));
                        this.updateAvatarStatus('Error loading avatar: ' + (error?.message || 'Unknown error'));
                }
        }

        async loadVRMFromBuffer(buffer, filePath) {
                // If the app is currently configured to use 2D renderer, handle image imports instead
                const engine = (this.settings && this.settings.rendererEngine) ? this.settings.rendererEngine : 'three';
                if (engine === '2d') {
                        debugLog('[app.js] Renderer set to 2D - attempting to load image from buffer');
                        try {
                                return await this.load2DFromBuffer(buffer, filePath);
                        } catch (e) {
                                debugLog('2D image load failed: ' + (e?.message || e));
                                throw e;
                        }
                }

                if (window.CelestisModules?.vrmLoader?.loadVRMFromBuffer) {
                        debugLog('[app.js] Module loader detected, delegating to vrmLoader.js');
                        try {
                                const result = await window.CelestisModules.vrmLoader.loadVRMFromBuffer({ THREE, debugLog }, buffer, filePath);
                                debugLog('[app.js] Module loader returned result');
                                return await this._handleLoadedVRM(result, filePath);
                        } catch (e) {
                                debugLog('Module VRM loader failed: ' + (e?.message || e));
                                throw e;
                        }
                } else {
                        debugLog('[app.js] No module loader found');
                        throw new Error('VRM loader module not available');
                }
        }

        // Load an image buffer into the 2D avatar canvas
        async load2DFromBuffer(buffer, filePath) {
                try {
                        // convert buffer to Blob and object URL and create an Image object, but don't draw immediately
                        const blob = new Blob([buffer], { type: 'image/*' });
                        const url = URL.createObjectURL(blob);

                        const img = await new Promise((resolve, reject) => {
                                const i = new Image();
                                i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
                                i.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error('Image load error')); };
                                i.src = url;
                        });

                        // Store the image for the 2D loop to render every frame
                        if (!this._2d) this._2d = { ctx: null, canvas: document.getElementById('avatarCanvas'), t: 0 };
                        this._2d.image = img;
                        this.updateAvatarStatus('2D Image Loaded: ' + (filePath || 'Image'));
                        debugLog('2D image buffered for drawing: ' + (filePath || 'image'));
                        return true;
                } catch (e) {
                        debugLog('load2DFromBuffer error: ' + (e?.message || e));
                        throw e;
                }
        }

        // Attempt to load a default embedded or internal avatar image
        async loadDefault2DAvatar() {
                try {
                        const list = await ipc.invoke('list-internal-avatars');
                        // Prefer explicit default filenames
                        const preferred = ['default-2d.png', 'default.png', 'avatar-2d.png'];
                        let found = null;
                        for (const p of preferred) {
                                const match = list.find(x => x.name.toLowerCase() === p.toLowerCase());
                                if (match) { found = match; break; }
                        }
                        // else fallback to any image
                        if (!found) {
                                found = list.find(x => ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(require('path').extname(x.name).toLowerCase()));
                        }
                        if (!found) return;

                        const buffer = await ipc.invoke('read-internal-avatar', found.name);
                        await this.load2DFromBuffer(buffer, found.name);
                        debugLog('Default 2D avatar loaded: ' + found.name);
                } catch (e) {
                        debugLog('No default 2D avatar found or failed to load: ' + (e?.message || e));
                }
        }

        async _handleLoadedVRM(result, filePath) {
                debugLog('[_handleLoadedVRM] Starting VRM handler');
                
                if (this.vrm) {
                        if (this.vrm.scene) {
                                this.scene.remove(this.vrm.scene);
                        }
                        if (this.vrm.dispose) {
                                this.vrm.dispose();
                        }
                        if (this.mixer) {
                                this.mixer.stopAllAction();
                                this.mixer = null;
                        }
                        debugLog('[_handleLoadedVRM] Removed existing VRM from scene');
                }
                
                const vrm = result.vrm;
                const scene = result.scene;
                
                let hasValidGeometry = false;
                let totalVertices = 0;
                scene.traverse((child) => {
                        if (child.isMesh && child.geometry && child.geometry.attributes?.position) {
                                const c = child.geometry.attributes.position.count;
                                if (c > 0) {
                                        hasValidGeometry = true;
                                        totalVertices += c;
                                }
                                debugLog('[_handleLoadedVRM] Found mesh: ' + (child.name || 'unnamed') + ' with ' + c + ' vertices');
                        }
                });
                
                if (!hasValidGeometry) {
                        this.updateAvatarStatus('VRM file contains no valid 3D geometry');
                        debugLog('[_handleLoadedVRM] Loaded scene has no valid geometry, removing any fallback placeholders');
                        // Remove any fallback placeholders so the UI does not keep showing them
                        this._removeFallbackPlaceholders();
                        return;
                }
                
                // Ensure we always have a wrapper object for this.vrm
                this.vrm = vrm || { scene: scene, animations: (result.gltf?.animations || []) };

                // Name and mark the loaded scene for easier debugging and removal of placeholders
                try {
                        if (scene && !scene.name) scene.name = 'Loaded_VRM';
                        if (scene) {
                                scene.userData = scene.userData || {};
                                scene.userData.sourceFile = filePath || 'memory';
                                scene.visible = true;
                                scene.updateMatrixWorld(true);
                        }
                } catch (e) { debugLog('[_handleLoadedVRM] Warning setting scene metadata: ' + (e?.message || e)); }

                this.scene.add(scene);
                debugLog('[_handleLoadedVRM] Added VRM scene to Three.js scene');
                
                if (vrm.humanoid) {
                        this.mixer = new THREE.AnimationMixer(scene);
                        debugLog('[_handleLoadedVRM] Animation mixer created for humanoid VRM');
                        this.loadIdleAnimation(vrm);
                }
                
                this.positionVRMAvatar(scene);
                
                const fileName = (typeof filePath === 'string' ? filePath.split(/[\\\/]/).pop() : 'Avatar') || 'Avatar';
                this.updateAvatarStatus('VRM Avatar Loaded: ' + fileName + ' (' + totalVertices + ' vertices)');
                debugLog('[_handleLoadedVRM] VRM loading completed successfully');
        }

        loadIdleAnimation(vrm) {
                debugLog('[loadIdleAnimation] Loading idle animation for VRM');
                
                try {
                        if (!vrm.humanoid) {
                                debugLog('[loadIdleAnimation] No humanoid rig, skipping animation');
                                return;
                        }
                        
                        const chest = vrm.humanoid.getNormalizedBoneNode('chest');
                        if (chest) {
                                const tracks = [];
                                const times = [0, 1, 2];
                                const values = [0, 0.02, 0];
                                
                                tracks.push(new THREE.NumberKeyframeTrack(
                                        chest.name + '.position.y',
                                        times,
                                        values
                                ));
                                
                                const clip = new THREE.AnimationClip('idle', 2, tracks);
                                const action = this.mixer.clipAction(clip);
                                action.play();
                                
                                debugLog('[loadIdleAnimation] Idle animation started');
                        }
                } catch (error) {
                        debugLog('[loadIdleAnimation] Error: ' + error.message);
                }
        }

        async _handleLoadedGLTF(gltf, filePath) {
                debugLog('[_handleLoadedGLTF] Starting');
                
                if (this.vrm && this.vrm.scene) {
                        this.scene.remove(this.vrm.scene);
                        debugLog('[_handleLoadedGLTF] Removed existing VRM from scene');
                }
                
                let hasValidGeometry = false;
                let totalVertices = 0;
                gltf.scene.traverse((child) => {
                        if (child.isMesh && child.geometry && child.geometry.attributes?.position) {
                                const c = child.geometry.attributes.position.count;
                                if (c > 0) {
                                        hasValidGeometry = true;
                                        totalVertices += c;
                                }
                                debugLog('[_handleLoadedGLTF] Found mesh: ' + child.name + ' with ' + c + ' vertices');
                        }
                });
                
                if (!hasValidGeometry) {
                        this.updateAvatarStatus('VRM file contains no valid 3D geometry');
                        return;
                }
                
                this.vrm = { scene: gltf.scene, animations: gltf.animations || [], update: () => {} };
                this.scene.add(gltf.scene);
                debugLog('[_handleLoadedGLTF] Added gltf.scene to Three.js scene');
                
                this.positionVRMAvatar(gltf.scene);
                
                const fileName = (typeof filePath === 'string' ? filePath.split(/[\\\/]/).pop() : 'Avatar') || 'Avatar';
                this.updateAvatarStatus('VRM Avatar Loaded: ' + fileName + ' (' + totalVertices + ' vertices)');
                debugLog('[_handleLoadedGLTF] VRM loading completed successfully via module delegate');
        }

        async validateVRMFile(buffer) {
                debugLog('[_handleLoadedFBX] Starting');
                
                if (this.vrm && this.vrm.scene) {
                        this.scene.remove(this.vrm.scene);
                        debugLog('[_handleLoadedFBX] Removed existing model from scene');
                }
                
                let hasValidGeometry = false;
                let totalVertices = 0;
                fbx.traverse((child) => {
                        if (child.isMesh && child.geometry && child.geometry.attributes?.position) {
                                const c = child.geometry.attributes.position.count;
                                if (c > 0) {
                                        hasValidGeometry = true;
                                        totalVertices += c;
                                }
                                debugLog('[_handleLoadedFBX] Found mesh: ' + (child.name || 'unnamed') + ' with ' + c + ' vertices');
                        }
                });
                
                if (!hasValidGeometry) {
                        this.updateAvatarStatus('FBX file contains no valid 3D geometry');
                        return;
                }
                
                this.vrm = { scene: fbx, animations: fbx.animations || [], update: () => {} };
                this.scene.add(fbx);
                debugLog('[_handleLoadedFBX] Added fbx to Three.js scene');
                
                this.positionVRMAvatar(fbx);
                
                const fileName = (typeof filePath === 'string' ? filePath.split(/[\\\/]/).pop() : 'FBX Model') || 'FBX Model';
                this.updateAvatarStatus('FBX Model Loaded: ' + fileName + ' (' + totalVertices + ' vertices)');
                debugLog('[_handleLoadedFBX] FBX loading completed successfully');
        }

        async validateVRMFile(buffer) {
                try {
                        debugLog('Validating VRM file, buffer size: ' + buffer.length + ' bytes');
                        
                        if (buffer.length < 4) {
                                debugLog('File too small to be a valid GLTF/VRM');
                                return false;
                        }
                        
                        const header = new Uint32Array(buffer.slice(0, 4));
                        const magic = header[0];
                        
                        debugLog('File magic number: 0x' + magic.toString(16));
                        
                        if (magic === 0x46546C67) {
                                debugLog('✓ File is binary GLTF/VRM (GLB format)');
                                if (buffer.length >= 12) {
                                        const version = new Uint32Array(buffer.slice(4, 8))[0];
                                        const length = new Uint32Array(buffer.slice(8, 12))[0];
                                        debugLog('GLB version: ' + version + ', declared length: ' + length);
                                        if (version === 2 && length <= buffer.length) {
                                                debugLog('✓ Valid GLB header structure');
                                                return true;
                                        }
                                }
                                return true;
                        }
                        
                        if (buffer.length >= 50) {
                                try {
                                        const textDecoder = new TextDecoder('utf-8', { fatal: false });
                                        const textStart = textDecoder.decode(buffer.slice(0, Math.min(1000, buffer.length)));
                                        
                                        const hasAsset = textStart.includes('"asset"');
                                        const hasGltf = textStart.includes('gltf') || textStart.includes('GLTF');
                                        const hasVersion = textStart.includes('"version"');
                                        const hasScene = textStart.includes('"scene');
                                        const hasNodes = textStart.includes('"nodes"');
                                        const hasMeshes = textStart.includes('"meshes"');
                                        
                                        if (hasAsset || (hasGltf && (hasVersion || hasScene || hasNodes || hasMeshes))) {
                                                debugLog('✓ File appears to be JSON GLTF/VRM');
                                                return true;
                                        }
                                        
                                        try {
                                                const jsonData = JSON.parse(textStart);
                                                if (jsonData && (jsonData.asset || jsonData.scene !== undefined || jsonData.nodes || jsonData.meshes)) {
                                                        debugLog('✓ File is valid JSON with GLTF-like structure');
                                                        return true;
                                                }
                                        } catch (jsonError) {
                                                debugLog('File is not valid JSON: ' + jsonError.message);
                                        }
                                        
                                } catch (textError) {
                                        debugLog('Error reading file as text: ' + textError.message);
                                }
                        }
                        
                        return true;
                        
                } catch (error) {
                        debugLog('Error validating VRM file: ' + error.message);
                        return true;
                }
        }

        positionVRMAvatar(scene) {
                try {
                        debugLog('=== VRM AVATAR POSITIONING DEBUG ===');

                        // Reset transforms on scene root to get consistent measurements
                        scene.updateMatrixWorld(true);
                        scene.position.set(0,0,0);
                        scene.rotation.set(0,0,0);
                        scene.scale.setScalar(1);

                        const box = new THREE.Box3().setFromObject(scene);
                        const size = box.getSize(new THREE.Vector3());
                        const center = box.getCenter(new THREE.Vector3());
                        
                        debugLog('VRM Avatar dimensions:');
                        debugLog('- Size: ' + size.x.toFixed(2) + ' x ' + size.y.toFixed(2) + ' x ' + size.z.toFixed(2));
                        
                        let meshCount = 0;
                        let visibleMeshes = 0;
                        
                        scene.traverse((child) => {
                                if (child.isMesh) {
                                        meshCount++;
                                        if (child.visible) visibleMeshes++;
                                }
                        });
                        
                        debugLog('- Total meshes: ' + meshCount + ' (' + visibleMeshes + ' visible)');
                        
                        if (size.y > 0) {
                                const targetHeight = 1.7;
                                let scale = targetHeight / Math.max(size.y, 0.0001);
                                // Clamp scaling to avoid extreme values
                                scale = Math.min(Math.max(scale, 0.1), 10);
                                scene.scale.setScalar(scale);
                                debugLog('Avatar scaled by factor: ' + scale.toFixed(2));

                                // Recompute box after scaling
                                const scaledBox = new THREE.Box3().setFromObject(scene);
                                const bottomY = scaledBox.min.y;
                                const scaledCenter = scaledBox.getCenter(new THREE.Vector3());

                                // Position the model so its base sits on y=0 and centered
                                scene.position.y = -bottomY;
                                scene.position.x = -scaledCenter.x;
                                scene.position.z = -scaledCenter.z;

                                const maxDimension = Math.max(scaledBox.getSize(new THREE.Vector3()).toArray());
                                // Ensure camera distance is reasonable
                                const camDistance = Math.min(Math.max(maxDimension * 2.5, 1.5), 20);
                                this.camera.position.set(camDistance, Math.max(1.2, maxDimension * 0.6), camDistance);
                                this.camera.lookAt(0, Math.max(0.8, scaledBox.getSize(new THREE.Vector3()).y * 0.5), 0);

                                // small nudge to avoid clipping
                                scene.position.x += Math.max(0, maxDimension * 0.1);

                                this.addDebugMarkers(scene);
                                this.forceAvatarVisibility(scene);
                                this.optimizeVRMForBackground(scene);
                        }
                        
                        debugLog('=== END VRM POSITIONING DEBUG ===');
                        
                } catch (error) {
                        debugLog('Error positioning VRM avatar: ' + error.message);
                }
        }

        addDebugMarkers(avatarScene) {
                try {
                        const existingMarkers = [];
                        this.scene.traverse((child) => {
                                if (child.name && child.name.startsWith('DEBUG_')) {
                                        existingMarkers.push(child);
                                }
                        });
                        existingMarkers.forEach(marker => this.scene.remove(marker));
                        
                        const redMarkerGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
                        const redMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                        const redMarker = new THREE.Mesh(redMarkerGeometry, redMarkerMaterial);
                        redMarker.position.set(avatarScene.position.x + 0.5, avatarScene.position.y + 1, avatarScene.position.z);
                        redMarker.name = 'DEBUG_RED_MARKER';
                        this.scene.add(redMarker);
                        
                        const greenMarkerGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
                        const greenMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
                        const greenMarker = new THREE.Mesh(greenMarkerGeometry, greenMarkerMaterial);
                        greenMarker.position.copy(avatarScene.position);
                        greenMarker.name = 'DEBUG_GREEN_MARKER';
                        this.scene.add(greenMarker);
                        
                        debugLog('Added debug markers');
                } catch (error) {
                        debugLog('Error adding debug markers: ' + error.message);
                }
        }

        forceAvatarVisibility(scene) {
                try {
                        debugLog('Forcing avatar visibility...');
                        let materialCount = 0;
                        
                        scene.traverse((child) => {
                                if (child.isMesh && child.material) {
                                        materialCount++;
                                        
                                        if (Array.isArray(child.material)) {
                                                child.material.forEach((mat) => {
                                                        if (mat.transparent && mat.opacity < 0.1) {
                                                                mat.opacity = 0.8;
                                                        }
                                                        if (!mat.visible) {
                                                                mat.visible = true;
                                                        }
                                                        if (!mat.color || (mat.color.r === 0 && mat.color.g === 0 && mat.color.b === 0)) {
                                                                mat.color = new THREE.Color(0xffffff);
                                                        }
                                                });
                                        } else {
                                                if (child.material.transparent && child.material.opacity < 0.1) {
                                                        child.material.opacity = 0.8;
                                                }
                                                if (!child.material.visible) {
                                                        child.material.visible = true;
                                                }
                                                if (!child.material.color || (child.material.color.r === 0 && child.material.color.g === 0 && child.material.color.b === 0)) {
                                                        child.material.color = new THREE.Color(0xffffff);
                                                }
                                        }
                                        
                                        if (!child.visible) {
                                                child.visible = true;
                                        }
                                }
                        });
                        
                        if (!scene.visible) {
                                scene.visible = true;
                        }
                        
                        debugLog('Processed ' + materialCount + ' materials for visibility');
                } catch (error) {
                        debugLog('Error forcing avatar visibility: ' + error.message);
                }
        }

        importVRM() {
                debugLog('Triggering VRM import...');
                ipc.send('import-vrm');
        }

        openSettings() {
                debugLog('Opening settings modal...');
                const settingsModal = document.getElementById('settingsModal');
                if (settingsModal) {
                        settingsModal.style.display = 'block';
                        debugLog('Settings modal displayed');
                        
                        const openrouterApiKey = document.getElementById('openrouterApiKey');
                        const aiModel = document.getElementById('aiModel');
                        const voiceLanguage = document.getElementById('voiceLanguage');
                        const initialTemplate = document.getElementById('initialTemplate');
                        const rendererEngine = document.getElementById('rendererEngine');
                        
                        if (openrouterApiKey) openrouterApiKey.value = this.settings.openrouterApiKey;
                        if (aiModel) aiModel.value = this.settings.aiModel;
                        if (voiceLanguage) voiceLanguage.value = this.settings.voiceLanguage;
                        if (initialTemplate) initialTemplate.value = this.settings.initialTemplate;
                        if (rendererEngine) rendererEngine.value = this.settings.rendererEngine || 'three';
                        // autosave the initialTemplate when the user types
                        if (initialTemplate) {
                                if (!this._initialTemplateAutosave) {
                                        const saveFn = async () => {
                                                this.settings.initialTemplate = initialTemplate.value;
                                                try {
                                                        await ipc.invoke('save-settings', this.settings);
                                                        debugLog('Autosaved initialTemplate');
                                                } catch (e) {
                                                        debugLog('Autosave failed: ' + (e?.message||e));
                                                }
                                        };
                                        this._initialTemplateAutosave = this.debounce(saveFn.bind(this), 600);
                                }
                                initialTemplate.addEventListener('input', this._initialTemplateAutosave);
                        }
                        
                        this.setupTemplatePresets();
                } else {
                        debugLog('ERROR: Settings modal not found!');
                }
        }

        closeSettings() {
                debugLog('Closing settings modal...');
                const settingsModal = document.getElementById('settingsModal');
                if (settingsModal) {
                        settingsModal.style.display = 'none';
                        debugLog('Settings modal hidden');
                }
        }

        async saveSettings() {
                debugLog('Saving settings...');
                const openrouterApiKey = document.getElementById('openrouterApiKey');
                const aiModel = document.getElementById('aiModel');
                const voiceLanguage = document.getElementById('voiceLanguage');
                const initialTemplate = document.getElementById('initialTemplate');
                
                if (openrouterApiKey) this.settings.openrouterApiKey = openrouterApiKey.value;
                if (aiModel) this.settings.aiModel = aiModel.value;
                if (voiceLanguage) this.settings.voiceLanguage = voiceLanguage.value;
                if (initialTemplate) this.settings.initialTemplate = initialTemplate.value;
                const rendererEngine = document.getElementById('rendererEngine');
                if (rendererEngine) this.settings.rendererEngine = rendererEngine.value;

                if (this.recognition) {
                        this.recognition.lang = this.settings.voiceLanguage;
                }

                try {
                        await ipc.invoke('save-settings', this.settings);
                        this.closeSettings();
                        this.addMessage('Settings saved successfully!', 'system');
                        debugLog('Settings saved successfully');
                } catch (error) {
                        debugLog('ERROR saving settings: ' + error.message);
                        this.addMessage('Error saving settings', 'system');
                }
        }

        async loadSettings() {
                try {
                        const savedSettings = await ipc.invoke('load-settings');
                        if (savedSettings) {
                                this.settings = { ...this.settings, ...savedSettings };
                                debugLog('Settings loaded successfully');
                        }
                } catch (error) {
                        debugLog('ERROR loading settings: ' + error.message);
                }
        }

        async sendMessage() {
                const textInput = document.getElementById('textInput');
                if (!textInput) {
                        debugLog('ERROR: Text input not found');
                        return;
                }
                
                const message = textInput.value.trim();
                
                if (!message) {
                        debugLog('Empty message, not sending');
                        return;
                }
                
                if (!this.settings.openrouterApiKey) {
                        this.addMessage('Please set your OpenRouter API key in settings.', 'system');
                        return;
                }

                textInput.value = '';
                this.addMessage(message, 'user');
                
                this.conversationHistory.push({
                        role: 'user',
                        content: message
                });

                try {
                        debugLog('Sending message to AI: ' + message);
                        const response = await this.callOpenRouterAPI();
                        this.addMessage(response, 'ai');
                        
                        this.conversationHistory.push({
                                role: 'assistant',
                                content: response
                        });
                        
                        if (this.vrm) {
                                this.animateAvatar('talk');
                        }
                } catch (error) {
                        debugLog('ERROR calling AI: ' + error.message);
                        this.addMessage('Error: Could not get AI response. Please check your API key and try again.', 'system');
                }
        }

        async callOpenRouterAPI() {
                const messages = [
                        {
                                role: 'system',
                                content: this.settings.initialTemplate
                        },
                        ...this.conversationHistory
                ];
                
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                                'Authorization': `Bearer ${this.settings.openrouterApiKey}`,
                                'Content-Type': 'application/json',
                                'X-Title': 'Celestis AI Avatar'
                        },
                        body: JSON.stringify({
                                model: this.settings.aiModel,
                                messages: messages,
                                max_tokens: 1000,
                                temperature: 0.7
                        })
                });

                if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                return data.choices[0].message.content;
        }

        addMessage(content, type) {
                const messagesContainer = document.getElementById('chatMessages');
                if (!messagesContainer) {
                        debugLog('ERROR: Messages container not found');
                        return;
                }
                
                const messageDiv = document.createElement('div');
                messageDiv.className = `message ${type}`;
                messageDiv.textContent = content;
                messagesContainer.appendChild(messageDiv);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        toggleVoiceRecording() {
                if (!this.recognition) {
                        this.updateVoiceStatus('Speech recognition not supported');
                        return;
                }

                if (this.isRecording) {
                        this.recognition.stop();
                } else {
                        this.recognition.lang = this.settings.voiceLanguage;
                        this.recognition.start();
                        this.isRecording = true;
                        const micBtn = document.getElementById('micBtn');
                        if (micBtn) {
                                micBtn.classList.add('recording');
                        }
                }
        }

        updateVoiceStatus(message) {
                const voiceStatus = document.getElementById('voiceStatus');
                if (voiceStatus) {
                        voiceStatus.textContent = message;
                }
        }

        updateAvatarStatus(status) {
                const avatarStatus = document.getElementById('avatarStatus');
                if (avatarStatus) {
                        avatarStatus.textContent = status;
                }
                debugLog('Avatar status: ' + status);
        }
        
        clearConversation() {
                debugLog('Clearing conversation history...');
                this.conversationHistory = [];
                
                const messagesContainer = document.getElementById('chatMessages');
                if (messagesContainer) {
                        messagesContainer.innerHTML = '';
                }
                
                this.addMessage('Conversation cleared. The AI will continue using the initial template.', 'system');
                debugLog('Conversation history cleared');
        }

        setupTemplatePresets() {
                const presets = {
                        friendly: "You are a warm, friendly AI assistant in a VRM avatar application. Be cheerful, enthusiastic, and supportive in all your responses. Use casual language and show genuine interest in helping users.",
                        professional: "You are a professional AI assistant with expertise across multiple domains. Provide clear, accurate, and well-structured responses. Maintain a courteous and business-appropriate tone.",
                        creative: "You are a creative AI assistant who loves to think outside the box. Be imaginative, inspiring, and help users explore new ideas. Encourage creativity and offer unique perspectives.",
                        technical: "You are a technical expert AI assistant specializing in programming, technology, and problem-solving. Provide detailed, accurate technical information and practical solutions."
                };

                const presetButtons = document.querySelectorAll('.preset-btn');
                const templateTextarea = document.getElementById('initialTemplate');

                presetButtons.forEach(button => {
                        button.addEventListener('click', (e) => {
                                e.preventDefault();
                                const presetType = button.getAttribute('data-preset');
                                if (presets[presetType] && templateTextarea) {
                                        templateTextarea.value = presets[presetType];
                                        debugLog('Applied ' + presetType + ' template preset');
                                }
                        });
                });

                debugLog('Template presets setup completed');
        }

        // Debounce helper
        debounce(fn, wait) {
                let t;
                return function(...args) {
                        clearTimeout(t);
                        t = setTimeout(() => fn.apply(this, args), wait);
                };
        }

        optimizeVRMForBackground(scene) {
                try {
                        debugLog('Optimizing VRM for background rendering...');
                        
                        scene.traverse((child) => {
                                if (child.isMesh && child.material) {
                                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                                        
                                        materials.forEach(material => {
                                                if (material.emissive) {
                                                        material.emissive.multiplyScalar(1.2);
                                                }
                                                material.needsUpdate = true;
                                                child.frustumCulled = false;
                                        });
                                }
                        });
                        
                        scene.frustumCulled = false;
                        debugLog('VRM optimization for background completed');
                } catch (error) {
                        debugLog('Error optimizing VRM for background: ' + error.message);
                }
        }

        validateFBXFile(buffer) {
                try {
                        debugLog('Validating FBX file, buffer size: ' + buffer.length + ' bytes');
                        
                        if (buffer.length < 27) {
                                debugLog('File too small to be a valid FBX');
                                return false;
                        }
                        
                        const header = new Uint8Array(buffer.slice(0, 27));
                        const magicString = new TextDecoder('ascii').decode(header.slice(0, 21));
                        
                        debugLog('FBX header: ' + magicString);
                        
                        if (magicString.startsWith('Kaydara FBX Binary')) {
                                debugLog('✓ File is binary FBX format');
                                return true;
                        }
                        
                        const textStart = new TextDecoder('ascii').decode(header.slice(0, 10));
                        if (textStart.includes('; FBX') || textStart.includes('FBX')) {
                                debugLog('✓ File appears to be ASCII FBX format');
                                return true;
                        }
                        
                        debugLog('✗ File does not appear to be a valid FBX format');
                        return false;
                        
                } catch (error) {
                        debugLog('Error validating FBX file: ' + error.message);
                        return true;
                }
        }

        animateAvatar(animationType) {
                if (!this.vrm) return;

                if (animationType === 'talk') {
                        const originalRotation = this.vrm.scene.rotation.clone();
                        const talkAnimation = () => {
                                this.vrm.scene.rotation.y = originalRotation.y + Math.sin(Date.now() * 0.005) * 0.05;
                        };
                        
                        const animationInterval = setInterval(talkAnimation, 16);
                        setTimeout(() => {
                                clearInterval(animationInterval);
                                this.vrm.scene.rotation.copy(originalRotation);
                        }, 2000);
                }
        }

        animate() {
                if (!this.renderer || !this.scene || !this.camera) return;
                
                requestAnimationFrame(() => this.animate());

                if (this.clock) {
                        const delta = this.clock.getDelta();

                        if (this.vrm && this.vrm.update) {
                                this.vrm.update(delta);
                        }

                        if (this.mixer) {
                                this.mixer.update(delta);
                        }
                        
                        if (this.backgroundParticles) {
                                this.backgroundParticles.rotation.y += delta * 0.1;
                                this.backgroundParticles.children.forEach((particle, index) => {
                                        particle.position.y += Math.sin(Date.now() * 0.001 + index) * 0.001;
                                });
                        }
                }

                this.renderer.render(this.scene, this.camera);
        }
}

debugLog('Script loaded, initializing app...');
window.celestisAI = new CelestisAI();
debugLog('CelestisAI instance created');
