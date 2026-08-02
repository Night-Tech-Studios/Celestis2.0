const { generateText } = require('ai');
const { createOpenRouter } = require('@openrouter/ai-sdk-provider');

const DEFAULT_MODEL = 'openai/gpt-4o-mini';

function cleanText(value) {
        return typeof value === 'string' ? value.trim() : '';
}

function buildSystemPrompt(settings = {}) {
        const promptLines = [
                'You are Celestis, the built-in AI assistant for a desktop Electron app with VRM avatar support.',
                'Be friendly, concise, and practical.',
                'Prefer responses that are easy to read aloud and keep them focused on the user\'s request.',
                'When the user has a name configured, use it naturally when it fits the conversation.',
                'If the user is asking about the app, avatars, speech, settings, or VRM features, answer as a product assistant first.',
                'Do not invent app capabilities or claim to have performed actions you cannot actually perform.',
                'If the user provides custom instructions, follow them unless they conflict with higher-priority behavior or safety.'
        ];

        const username = cleanText(settings.username);
        if (username) {
                promptLines.push(`User name: ${username}. Address the user by this name when natural.`);
        }

        const rendererEngine = cleanText(settings.rendererEngine).toLowerCase();
        if (rendererEngine) {
                promptLines.push(`Current renderer mode: ${rendererEngine}. Keep answers compatible with the app's current mode.`);
        }

        const voiceLanguage = cleanText(settings.voiceLanguage);
        if (voiceLanguage) {
                promptLines.push(`Voice language: ${voiceLanguage}. Keep wording natural for speech output.`);
        }

        if (settings.avatarInChat) {
                promptLines.push('The avatar can appear in chat, so favor slightly shorter and more conversational responses.');
        }

        const customTemplate = cleanText(settings.initialTemplate);
        if (customTemplate) {
                promptLines.push('User custom instructions:');
                promptLines.push(customTemplate);
        }

        return promptLines.join('\n');
}

function normalizeConversationHistory(conversationHistory) {
        if (!Array.isArray(conversationHistory)) {
                return [];
        }

        return conversationHistory
                .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && message.content.trim())
                .slice(-20)
                .map((message) => ({
                        role: message.role,
                        content: message.content.trim()
                }));
}

function getCandidateModels(preferredModel) {
        const candidates = [preferredModel, DEFAULT_MODEL, 'mistral-7b-instruct-free']
                .map(cleanText)
                .filter(Boolean);

        return [...new Set(candidates)];
}

async function generateCelestisReply({ apiKey, model, conversationHistory, settings }) {
        const key = cleanText(apiKey);
        if (!key) {
                throw new Error('OpenRouter API key is missing');
        }

        const provider = createOpenRouter({
                apiKey: key,
                headers: {
                        'X-Title': 'Celestis AI Avatar'
                }
        });

        const messages = [
                {
                        role: 'system',
                        content: buildSystemPrompt(settings)
                },
                ...normalizeConversationHistory(conversationHistory)
        ];

        const candidates = getCandidateModels(model);
        let lastError = null;

        for (const candidate of candidates) {
                try {
                        const result = await generateText({
                                model: provider(candidate),
                                messages,
                                maxTokens: 1000,
                                temperature: 0.7
                        });

                        return {
                                text: result.text,
                                model: candidate,
                                providerMetadata: result.providerMetadata || null
                        };
                } catch (error) {
                        lastError = error;
                        const status = error && (error.statusCode || error.status || error.response?.status);
                        const message = error && error.message ? error.message : String(error);
                        console.warn(`[ai-core] OpenRouter request failed for model ${candidate}${status ? ` (${status})` : ''}: ${message}`);
                }
        }

        throw lastError || new Error('OpenRouter request failed');
}

module.exports = {
        DEFAULT_MODEL,
        buildSystemPrompt,
        generateCelestisReply,
        normalizeConversationHistory
};