# Celestis AI Avatar

A desktop AI application featuring VRM avatar support, OpenRouter API integration, and speech-to-text capabilities.
## Version 1.0

Version 1.0 got archived due to poor performance in tests and in most of machines (becouse of the lack of NPU cores) and since celestis is an project made to be in more computers then just the apple M series, snapdragon elite x series, intel core Ultra series and AMD Ai series computers or computers with newer gpus (RTX 40 and 50 Series and intel and AMD equivalents) the project was redone and rewrited in another language to use openrouter ai cloud API to be used in most of the computers

## Features

- **VRM Avatar Support**: Import and display VRM files as 3D avatars (WIP)
- **OpenRouter API Integration**: Connect to various AI models (Claude, GPT-4, Llama, etc.)
- **Speech-to-Text**: Voice input with multiple language support
- **Text Input**: Traditional text-based chat interface
- **Desktop Application**: Built with Electron for cross-platform compatibility
- **Real-time 3D Rendering**: Powered by Three.js and three-vrm (WIP)

## Setup Instructions

### Prerequisites

1. **Node.js** (version 16 or higher)
2. **npm** (comes with Node.js)
3. **OpenRouter API Key** - Get one from [OpenRouter.ai](https://openrouter.ai/)

### Installation

1. **Navigate to the project directory:**
   ```powershell
   cd f:\Celestis2.0
   ```

2. **Install dependencies:**
   ```powershell
   npm install
   ```

3. **Start the application:**
   ```powershell
   npm start
   ```

### Configuration

1. **Set up OpenRouter API:**
   - Click the "Settings" button in the app
   - Enter your OpenRouter API key
   - Select your preferred AI model
   - Choose your voice recognition language
   - Click "Save Settings"

2. **Import VRM Avatar:** bot working at moment
   - Click "Import VRM" or use File > Import VRM
   - Select a VRM file from your computer
   - The avatar will appear in the 3D viewport

### Usage

1. **Text Chat:**
   - Type your message in the text input
   - Press Enter or click "Send"
   - The AI will respond and the avatar will animate

2. **Voice Chat:**
   - Click the microphone button (🎤)
   - Speak your message
   - The text will appear in the input field
   - Send the message normally

3. **Avatar Interaction:**
   - The avatar will perform simple animations during conversations
   - Import different VRM files to change avatars

### Development

To run in development mode with DevTools:
```powershell
npm run dev
```

To build for distribution:
```powershell
npm run build
```

### Supported File Formats

- **VRM Files**: .vrm (VRM 0.x and 1.0)

### Supported AI Models

- Claude 3 Haiku/Sonnet
- GPT-4/GPT-3.5 Turbo
- Llama 2 70B
- And many more through OpenRouter

### Voice Recognition Languages

- English (US/UK)
- Spanish
- French
- German
- Japanese
- And more...

## Troubleshooting

### Common Issues

1. **"Speech recognition not supported"**
   - Make sure you're using a Chromium-based browser engine
   - Check microphone permissions

2. **VRM file won't load**
   - Ensure the file is a valid VRM format
   - Check file permissions
   - Try a different VRM file

3. **AI not responding**
   - Verify your OpenRouter API key is correct
   - Check your internet connection
   - Make sure you have credits/quota on OpenRouter

4. **Avatar not animating**
   - Ensure the VRM file contains proper bone structure
   - Check browser console for errors

### File Locations

- Settings: persistent settings are stored in the OS user data directory (e.g. on Linux: ~/.config/<app>, on Windows: %APPDATA%\<app>). During development the app will also read `settings.json` in the repository root and attempt to migrate it to the user data directory on first run.
- VRM files: Import from anywhere on your system

## Web / Mobile WebView build

There is a minimal web-friendly preview in `web/` that uses ESM imports so it can run in a browser or be embedded in mobile WebViews (Capacitor, Cordova, React Native WebView). See `web/README_WEB.md` for details.

## License

MIT License - Feel free to modify and distribute!