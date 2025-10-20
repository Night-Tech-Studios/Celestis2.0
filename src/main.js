const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let previewWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
      webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    title: 'Celestis AI Avatar'
  });

  mainWindow.loadFile('src/index.html');

  // Create preview window for 3D environment
  createPreviewWindow();

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Always open DevTools for debugging
  mainWindow.webContents.openDevTools();

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
    if (previewWindow && !previewWindow.isDestroyed()) {
      // Send a copy of the buffer as an ArrayBuffer to avoid serialization issues
      const arr = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      previewWindow.webContents.send('preview-load-buffer', arr, name || 'avatar');
      event.returnValue = true;
    } else {
      console.warn('Preview window not available to forward buffer');
      event.returnValue = false;
    }
  } catch (e) {
    console.error('Error forwarding to preview:', e);
    try { event.returnValue = false; } catch(_) {}
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    console.log('Saving settings:', settings);
    const settingsPath = path.join(__dirname, '../settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('Settings saved to:', settingsPath);
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
});

ipcMain.handle('load-settings', async () => {
  try {
    const settingsPath = path.join(__dirname, '../settings.json');
    console.log('Loading settings from:', settingsPath);
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      console.log('Settings loaded:', settings);
      return settings;
    }
    console.log('No settings file found');
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