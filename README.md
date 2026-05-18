# Celestis AI Avatar

A desktop AI application featuring VRM avatar support, OpenRouter API integration, and speech-to-text capabilities.

## Current stable version and quick information about the future of the project 

At now the current stable version is 2.2 due to a bug in version 2.3 be causing a abnormal behavior in config files and some other unknown file that is increasing in size without anything being altered,also some other functions like the experimental first start quick setup aren't working properly,in that case the first start quick setup is triggering every single time,that doesn't supposed to happen,at now I am working in both versions (regular that is the one is recommended using because it has all features,and TCC Version that is made for my graduation thesis having less functions to maintain the research clear and in equal ambient for any user, avoiding results corruption due to different research environments from different users in our research) and hope to release soon a new version with new features and new avatars, probably i will include some new ones based in animes like Demon Slayer,Naruto Shippuden,Konosuba,Frieren (yes another avatar from that anime),also I plan to put avatars from games like, Resident Evil (the franchise as a whole), Clair Obscur Expedition 33 (still thinking on who), Bloodborne,Death Stranding (still thinking about that) Alan Wake (franchise including also Control),The Last of Us,Red dead redemption,God of War, also thinking on characters of other types of media that I won't specify here due to the early stages of development of the personality input prompts,maybe from all specified avatars less than half are going to be implemented in 2.4 because of the personality input prompt testing and improving process,i am also announcing that 2.0 version 3d compatibility will be a dead function,i will not try to repair the 3d rendering due to lots of problems with it lately,the code will remain there for any of you that want to adventure with that and probably repair the system,if anyone one can repair I will link the version in the official Celestis GitHub as a oficial version,and you are going to be credited by that instead of myself,even after the version 3.0 released i will do that as a official 2.0 release, almost like Sony did with PS3 lately (at the time this is written 02/04/2026 following the date pattern day/month/year)

## Version 1.0

Version 1.0 got archived due to poor performance in tests and in most of machines (becouse of the lack of NPU cores) and since celestis is an project made to be in more computers then just the apple M series, snapdragon elite x series, intel core Ultra series and AMD Ai series computers or computers with newer gpus (RTX 40 and 50 Series and intel and AMD equivalents) the project was redone and rewrited in another language to use openrouter ai cloud API to be used in most of the computers

## Version 3.0

During the time I was testing the project after a break in development I started to develop a concept version of a new version that is totally redone in new tools,I looked a lot of other projects with the same idea and noticed a pattern, almost every single one uses Unity Engine as a 3d engine for development,i know Unity is well know by their games but also many softwares that has 3d functions use them,some well know tracking apps used by the VTuber community are made in unity,also some other apps that aids that community,I am currently developing a 3.0 concept in Unity that will continue the development on the latest 2.x version that is the latest during the time the 3.0 is released, almost like the office package of Microsoft,they make a new version but continue most functions of the older ones

## Features

- **VRM Avatar Support**: Import and display VRM files as 3D avatars (Dead Function,it is disabled and will not receive updates by me will be removed from the readme after some versions)
- **OpenRouter API Integration**: Connect to various AI models (Claude, GPT-4, Llama, etc.)
- **Speech-to-Text**: Voice input with multiple language support (Still working on a bug in the system that make the system don't work at all)
- **Text Input**: Traditional text-based chat interface
- **Desktop Application**: Built with Electron for cross-platform compatibility
- **Real-time 3D Rendering**: Powered by babylon.js (Dead Function,it is disabled and will not receive updates by me will be removed from the readme after some version)

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

### Development

To run in development mode with DevTools:
```powershell
npm run dev
```

To build for distribution:
```powershell
npm run build
```

### Supported AI Models

- Claude
- GPT
- Llama (recommend LLM,it is the one used in all the personality input prompt tests and also is the LLM used by me in all the development process)
- And many more through OpenRouter (need some minor modifications by the user for that)

### Voice Recognition Languages (written before the bug that broke the system)

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
   - the system is broken and is a dead function,don't expect to see any changes in that and any loading on the function either

3. **AI not responding**
   - Verify your OpenRouter API key is correct
   - Check your internet connection
   - Make sure you have credits/quota on OpenRouter


### File Locations

- Settings: persistent settings are stored in the OS user data directory (e.g. on Linux: ~/.config/<app>, on Windows: %APPDATA%\<app>). During development the app will also read `settings.json` in the repository root and attempt to migrate it to the user data directory on first run.

## External TTS (SoVITS / GPT-SoVITS-Inference)

This project can delegate Text-to-Speech (TTS) to an external SoVITS-style inference server such as the GPT-SoVITS-Inference project (https://github.com/AI-Hobbyist/GPT-SoVITS-Inference).

Quick setup:

1. Clone and run the GPT-SoVITS-Inference server locally following its instructions. A common local URL is `http://localhost:7860`.
2. Start the Celestis app and open Settings → TTS.
3. Enable `Use external SoVITS inference server`, set `Server URL` to your server (e.g. `http://localhost:7860`), optionally set `Endpoint` (defaults tried: `/generate`, `/synthesis`, `/tts`, `/api/tts`, `/sovits/infer`) and `Speaker` to the desired voice id or name.
4. Click `Test TTS` to send a short test phrase and play audio returned by the server.

Supported response formats:
- Direct audio response (`audio/wav`, `audio/mpeg`, etc.) — the client will play the returned audio.
- JSON response containing base64 audio in a field named `audio`, `wav`, or `base64`.
- Plain base64 text body containing the audio payload.

If your GPT-SoVITS-Inference server uses a different API (form fields, model names, different JSON schema), provide the exact request/response details and I can adjust the client to match it.
another experimental function expect bugs since that function is from a mod I started working (maintained it alive after the original developer stop working on it due to the software that the modification was designed dropped mod support after a version) some time ago,and even in the mod the integration didn't work as expected,

## Web / Mobile WebView build

There is a minimal web-friendly preview in `web/` that uses ESM imports so it can run in a browser or be embedded in mobile WebViews (Capacitor, Cordova, React Native WebView). See `web/README_WEB.md` for details.

## License

MIT License - Feel free to modify and distribute!
