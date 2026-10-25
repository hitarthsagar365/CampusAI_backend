const axios = require('axios');

// Base URL for Google Generative Language REST API
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Ordered fallback models — first available one wins
const MODELS = [
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-preview-05-20',
  'gemini-1.5-flash-latest',
  'gemini-pro',
];

const buildSystemContext = (role) =>
  `You are a helpful assistant for CampusAI, a college management platform. You help users navigate the application.

Roles:
- STUDENT: Dashboard, attendance, assignments, marks, notes/materials, messages to faculty, profile, settings.
- TEACHER: Dashboard, manage classes, create assignments, mark attendance, gradebook, upload materials, notices, messages.
- ADMIN: Full platform control — manage students/faculty/courses/subjects/classes, attendance, marks, notices, events, materials, assignments, timetables, messages.

Current user is a ${role.toUpperCase()}.
Only answer questions about CampusAI features. Keep answers concise and use bullet points for steps.`;

/**
 * Call Gemini REST API directly using axios with a hard timeout.
 * Avoids SDK hanging indefinitely on overloaded models.
 */
const callGemini = async (apiKey, modelName, systemContext, chatHistory, message) => {
  const url = `${GEMINI_BASE}/${modelName}:generateContent?key=${apiKey}`;

  // Build contents array: system prompt as first user turn if history is empty
  const contents = [];

  // Add prior conversation turns
  for (const h of chatHistory) {
    contents.push({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }],
    });
  }

  // Add current user message
  contents.push({ role: 'user', parts: [{ text: message }] });

  const body = {
    systemInstruction: { parts: [{ text: systemContext }] },
    contents,
    generationConfig: {
      maxOutputTokens: 512,
      temperature: 0.7,
    },
  };

  // 12-second hard timeout per model — prevents hanging
  const response = await axios.post(url, body, { timeout: 12000 });
  const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!reply) throw new Error('Empty response from model');
  return reply;
};

/**
 * POST /api/ai-chatbot/ask
 */
const askChatbot = async (req, res) => {
  const { message, role = 'student', history = [] } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Message is required.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'GEMINI_API_KEY is not configured.' });
  }

  const systemContext = buildSystemContext(role);
  const chatHistory = history.map((h) => ({
    role: h.role === 'user' ? 'user' : 'model',
    text: h.text,
  }));

  let lastError;
  for (const modelName of MODELS) {
    try {
      const reply = await callGemini(apiKey, modelName, systemContext, chatHistory, message.trim());
      console.log(`[AI Chatbot] OK — model: ${modelName}`);
      return res.status(200).json({ success: true, reply });
    } catch (err) {
      const status = err?.response?.status;
      const msg = err?.message || '';
      console.warn(`[AI Chatbot] Model "${modelName}" failed (${status || 'timeout'}): ${msg}`);
      lastError = err;

      // Stop immediately for auth/billing errors — retrying won't help
      if (status === 400 || status === 401 || status === 403) break;
      // For 404 / 503 / timeout — try next model
    }
  }

  console.error('[AI Chatbot] All models failed:', lastError?.message);
  return res.status(500).json({
    success: false,
    message: 'AI service is temporarily unavailable. Please try again in a moment.',
  });
};

/**
 * GET /api/ai-chatbot/test  (public, no auth)
 * Tests each model with a 10s timeout and reports results.
 */
const testChatbot = async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'GEMINI_API_KEY not set.' });
  }

  const results = [];

  for (const modelName of MODELS) {
    try {
      const url = `${GEMINI_BASE}/${modelName}:generateContent?key=${apiKey}`;
      const body = {
        contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
        generationConfig: { maxOutputTokens: 10 },
      };
      const response = await axios.post(url, body, { timeout: 10000 });
      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '(empty)';
      results.push({ model: modelName, status: 'ok', reply: text });

      // First working model found — return success immediately
      return res.status(200).json({
        success: true,
        keyPrefix: apiKey.substring(0, 8) + '...',
        workingModel: modelName,
        results,
      });
    } catch (err) {
      const status = err?.response?.status || 'timeout';
      const error = err?.response?.data?.error?.message || err?.message || 'unknown';
      results.push({ model: modelName, status: `error_${status}`, error });
    }
  }

  return res.status(500).json({
    success: false,
    keyPrefix: apiKey.substring(0, 8) + '...',
    message: 'All models failed.',
    results,
  });
};

module.exports = { askChatbot, testChatbot };
