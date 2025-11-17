const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Ensure hardware acceleration / GPU features are encouraged on startup.
// These command-line switches help on Windows where ANGLE/D3D may be required
// and can enable WebGL2/WebGPU related features. They are additive and
// will be ignored if unsupported by the current platform/Electron build.
try {
  app.commandLine.appendSwitch('ignore-gpu-blacklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-webgl2-compute-context');
  app.commandLine.appendSwitch('use-angle', 'd3d11');
  app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('enable-experimental-web-platform-features');
} catch (e) {
  console.warn('Failed to append GPU-related commandLine switches:', e && e.message);
}

let mainWindow;
let previewWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
      webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Opt-in to experimental/accelerated features where available
      experimentalFeatures: true,
      // Offscreen rendering disabled by default; keep it explicit
      offscreen: false
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    title: 'Celestis AI'
  });

  mainWindow.loadFile('src/index.html');

  // Preview window is created on demand now (opened by user via UI)

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }


  // Create menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Import 3D Model',
          click: () => {
            console.log('Menu: Import VRM clicked');
            importVRM();
          }
        },
        {
          label: 'Settings',
          click: () => {
            console.log('Menu: Settings clicked');
            mainWindow.webContents.send('open-settings');
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createPreviewWindow() {
  try {
    previewWindow = new BrowserWindow({
      width: 900,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      title: 'Celestis Avatar Preview'
    });

    previewWindow.loadFile('src/preview.html');

    // Open devtools for preview as well when --dev
    if (process.argv.includes('--dev')) previewWindow.webContents.openDevTools();

    previewWindow.on('closed', () => {
      previewWindow = null;
    });
  } catch (e) {
    console.error('Failed to create preview window', e);
  }
}

async function importVRM() {
  try {
    console.log('importVRM function called');
    
    // Check if mainWindow exists and is not destroyed
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.error('Main window is not available');
      return;
    }
    
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'VRM Files', extensions: ['vrm'] },
        { name: 'GLTF Files', extensions: ['gltf', 'glb'] },
        { name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    console.log('Dialog result:', result);

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      console.log('Selected file:', filePath);
      
      // Double-check window is still available before sending
      if (!mainWindow || mainWindow.isDestroyed()) {
        console.error('Main window became unavailable after dialog');
        return;
      }
      
      console.log('Sending vrm-selected message to renderer');
      mainWindow.webContents.send('vrm-selected', filePath);
    } else {
      console.log('No file selected or dialog canceled');
    }
  } catch (error) {
    console.error('Error in importVRM:', error);
    console.error('Error stack:', error.stack);
  }
}

// IPC handlers
ipcMain.handle('read-vrm-file', async (event, filePath) => {
  try {
    console.log('Reading VRM file:', filePath);
    const buffer = fs.readFileSync(filePath);
    console.log('File read successfully, size:', buffer.length, 'bytes');
    return buffer;
  } catch (error) {
    console.error('Error reading VRM file:', error);
    throw error;
  }
});

// Add the missing IPC handler for import-vrm
ipcMain.on('import-vrm', (event) => {
  console.log('Received import-vrm IPC message from renderer');
  importVRM();
});

// Forward buffer from renderer to preview window
ipcMain.on('forward-to-preview', (event, buffer, name) => {
  try {
    // Ensure preview window exists; create on demand if missing
    if (!previewWindow || previewWindow.isDestroyed()) {
      try {
        createPreviewWindow();
      } catch (e) {
        console.error('Failed to create preview window on demand:', e);
        try { event.returnValue = false; } catch(_){}
        return;
      }
    }

    // Send a copy of the buffer as an ArrayBuffer to avoid serialization issues
    const arr = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    previewWindow.webContents.send('preview-load-buffer', arr, name || 'avatar');
    event.returnValue = true;
  } catch (e) {
    console.error('Error forwarding to preview:', e);
    try { event.returnValue = false; } catch(_) {}
  }
});

// IPC: request to open (or focus) the preview window
ipcMain.on('open-preview-window', (event) => {
  try {
    if (!previewWindow || previewWindow.isDestroyed()) createPreviewWindow();
    if (previewWindow) {
      previewWindow.show();
      previewWindow.focus();
      event.returnValue = true;
      return;
    }
  } catch (e) {
    console.error('open-preview-window failed:', e);
  }
  try { event.returnValue = false; } catch(_) {}
});

// IPC: import a 2D image file (png/jpg/webp/gif) and return buffer + filename
ipcMain.handle('import-2d', async (event) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Image Files', extensions: ['png','jpg','jpeg','webp','gif'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const buffer = fs.readFileSync(filePath);
    return { buffer, name: path.basename(filePath) };
  } catch (e) {
    console.error('import-2d failed:', e);
    throw e;
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    console.log('Saving settings:', settings);

    // Persist settings to the user data directory so packaged apps can write to it
    const userDataDir = app.getPath('userData');
    const userSettingsPath = path.join(userDataDir, 'settings.json');

    try {
      // Ensure directory exists (should exist) and write settings there
      fs.writeFileSync(userSettingsPath, JSON.stringify(settings, null, 2));
      console.log('Settings saved to userData:', userSettingsPath);
      return true;
    } catch (writeErr) {
      console.error('Failed to write settings to userData path, attempting fallback to bundle path:', writeErr);
      // Fallback (development) - write next to the application folder if writable
      const fallbackPath = path.join(__dirname, '../settings.json');
      try {
        fs.writeFileSync(fallbackPath, JSON.stringify(settings, null, 2));
        console.log('Settings saved to fallback path:', fallbackPath);
        return true;
      } catch (fbErr) {
        console.error('Fallback write also failed:', fbErr);
        return false;
      }
    }
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
});

ipcMain.handle('load-settings', async () => {
  try {
    // Prefer settings stored in the OS user data directory (works for packaged apps)
    const userDataDir = app.getPath('userData');
    const userSettingsPath = path.join(userDataDir, 'settings.json');

    console.log('Loading settings, checking userData path first:', userSettingsPath);
    if (fs.existsSync(userSettingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(userSettingsPath, 'utf8'));
        console.log('Settings loaded from userData:', userSettingsPath);
        return settings;
      } catch (e) {
        console.error('Failed to parse settings from userData path:', e);
        // fall through to try repo path
      }
    }

    // Development fallback: check for settings next to the app (repo root during dev)
    const repoSettingsPath = path.join(__dirname, '../settings.json');
    console.log('Checking fallback repo settings path:', repoSettingsPath);
    if (fs.existsSync(repoSettingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(repoSettingsPath, 'utf8'));
        console.log('Settings loaded from repository path:', repoSettingsPath);

        // Attempt to migrate to userData for future reads/writes
        try {
          const destDir = app.getPath('userData');
          const destPath = path.join(destDir, 'settings.json');
          fs.writeFileSync(destPath, JSON.stringify(settings, null, 2));
          console.log('Migrated settings to userData path:', destPath);
        } catch (migrateErr) {
          console.warn('Could not migrate settings to userData:', migrateErr && (migrateErr.message || migrateErr));
        }

        return settings;
      } catch (e) {
        console.error('Failed to parse repository settings file:', e);
      }
    }

    console.log('No settings file found in userData or repo path');
    return null;
  } catch (error) {
    console.error('Error loading settings:', error);
    return null;
  }
});

// Log when the main process is ready
app.whenReady().then(() => {
  console.log('Electron app ready, creating window...');
  createWindow();
  // Enable autostart on Windows (register the app to run at login)
  try {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: []
      });
      console.log('Autostart enabled for Windows login');
    }
  } catch (e) {
    console.warn('Failed to set autostart:', e.message || e);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Log IPC communication for debugging
ipcMain.on('debug-log', (event, message) => {
  console.log('Renderer log:', message);
});

// List internal avatars from assets/avatars
ipcMain.handle('list-internal-avatars', async () => {
  try {
    const dir = path.join(__dirname, '../assets/avatars');
    if (!fs.existsSync(dir)) {
      return [];
    }
    const entries = fs.readdirSync(dir);
  const allowed = ['.vrm', '.glb', '.gltf', '.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const files = entries
      .filter(name => allowed.includes(path.extname(name).toLowerCase()))
      .map(name => ({
        name,
        path: path.join(dir, name)
      }));
    return files;
  } catch (e) {
    console.error('Error listing internal avatars:', e);
    return [];
  }
});

// Read internal avatar file buffer by relative name
ipcMain.handle('read-internal-avatar', async (event, fileName) => {
  try {
    const fullPath = path.join(__dirname, '../assets/avatars', fileName);
    if (!fs.existsSync(fullPath)) throw new Error('File not found: ' + fileName);
    const buffer = fs.readFileSync(fullPath);
    return buffer;
  } catch (e) {
    console.error('Error reading internal avatar:', e);
    throw e;
  }
});

// Provide UMD sources for three and GLTFLoader to renderer on demand (useful when preload fails to attach)
ipcMain.handle('get-three-umd', async () => {
  try {
    console.log('[main] get-three-umd invoked');
    const fs = require('fs');
    const path = require('path');
    let result = { three: null, gltf: null, found: false };
    try {
      const threePkg = require.resolve('three/package.json');
      console.log('[main] resolved three package.json at', threePkg);
      const threeBase = path.dirname(threePkg);
      const candidates = [
        path.join(threeBase, 'build', 'three.js'),
        path.join(threeBase, 'build', 'three.min.js'),
        path.join(threeBase, 'build', 'three.module.js')
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          console.log('[main] found three UMD candidate:', c);
          result.three = fs.readFileSync(c, 'utf8');
          result.found = true;
          break;
        }
      }

      const gltfCandidates = [
        path.join(threeBase, 'examples', 'js', 'loaders', 'GLTFLoader.js'),
        path.join(threeBase, 'examples', 'jsm', 'loaders', 'GLTFLoader.js')
      ];
      for (const c of gltfCandidates) {
        if (fs.existsSync(c)) {
          console.log('[main] found gltf candidate:', c);
          result.gltf = fs.readFileSync(c, 'utf8');
          result.found = true;
          break;
        }
      }

      // FBX support intentionally omitted from UMD helper
    } catch (e) {
      console.warn('[main] get-three-umd resolution failed:', e && e.message);
      // ignore resolution errors
    }
    console.log('[main] get-three-umd result found=', result.found, ' three=', !!result.three, ' gltf=', !!result.gltf);
    return result;
  } catch (e) {
    console.error('get-three-umd handler failed:', e && e.message);
    return { three: null, gltf: null, found: false };
  }
});

// IPC helper: read loader sources (jsm and examples/js) from node_modules and return as strings
ipcMain.handle('read-loader-sources', async () => {
  try {
    console.log('[main] read-loader-sources invoked');
    const result = { jsm: { gltf: null }, js: { gltf: null }, threeModule: null, found: false };
    try {
      const threePkg = require.resolve('three/package.json');
      const threeBase = path.dirname(threePkg);

      // three.module (ESM) path
      const threeModulePath = path.join(threeBase, 'build', 'three.module.js');
      if (fs.existsSync(threeModulePath)) {
        result.threeModule = fs.readFileSync(threeModulePath, 'utf8');
        result.found = true;
        console.log('[main] found three.module.js at', threeModulePath);
      }

      // jsm loaders
      const jsmGltf = path.join(threeBase, 'examples', 'jsm', 'loaders', 'GLTFLoader.js');
      if (fs.existsSync(jsmGltf)) { result.jsm.gltf = fs.readFileSync(jsmGltf, 'utf8'); result.found = true; console.log('[main] found jsm GLTFLoader at', jsmGltf); }

      // classic examples/js loaders (UMD-style) - useful if jsm isn't usable
      const jsGltf = path.join(threeBase, 'examples', 'js', 'loaders', 'GLTFLoader.js');
      if (fs.existsSync(jsGltf)) { result.js.gltf = fs.readFileSync(jsGltf, 'utf8'); result.found = true; console.log('[main] found js GLTFLoader at', jsGltf); }
    } catch (e) {
      console.warn('[main] read-loader-sources resolution failed:', e && e.message);
    }
    console.log('[main] read-loader-sources result found=', result.found);
    return result;
  } catch (e) {
    console.error('[main] read-loader-sources handler failed:', e && e.message);
    return { jsm: { gltf: null }, js: { gltf: null }, threeModule: null, found: false };
  }
});