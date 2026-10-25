const axios = require('axios');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Ordered fallback list — confirmed available from /models endpoint
const MODELS = [
  'gemini-3.5-flash',      // lighter, faster
  'gemini-3.5-flash-lite', // even lighter
  'gemini-3.8-flash',      // latest, may be congested
  'gemini-2.5-flash',      // older fallback
];

const buildSystemContext = (role) =>
  `You are a helpful assistant for CampusAI, a college management platform.

Roles:
- STUDENT: Dashboard, attendance, assignments, marks, notes/materials, messages to faculty, profile, settings.
- TEACHER: Dashboard, manage classes, create assignments, mark attendance, gradebook, upload materials, notices, messages.
- ADMIN: Full platform control — students, faculty, courses, subjects, classes, attendance, marks, notices, events, materials, assignments, timetables, messages.

Current user: ${role.toUpperCase()}.
Only answer CampusAI questions. Be concise. Use bullet points for steps.`;

/**
 * Call Gemini REST API with the given model. Returns the reply text or throws.
 */
const callModel = async (apiKey, modelName, body, timeoutMs) => {
  const url = `${GEMINI_BASE}/${modelName}:generateContent?key=${apiKey}`;
  const response = await axios.post(url, body, { timeout: timeoutMs });
  const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) throw new Error('Empty response');
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
  const contents = [];
  for (const h of (history || [])) {
    contents.push({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }],
    });
  }
  contents.push({ role: 'user', parts: [{ text: message.trim() }] });

  const body = {
    systemInstruction: { parts: [{ text: systemContext }] },
    contents,
    generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
  };

  // Use env model first, then fallback list
  const envModel = process.env.GEMINI_MODEL;
  const modelsToTry = envModel ? [envModel, ...MODELS.filter(m => m !== envModel)] : MODELS;

  let lastError;
  for (const modelName of modelsToTry) {
    try {
      const reply = await callModel(apiKey, modelName, body, 35000);
      console.log(`[AI Chatbot] OK — ${modelName}`);
      return res.status(200).json({ success: true, reply });
    } catch (err) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error?.message || err?.message || '';
      console.warn(`[AI Chatbot] ${modelName} failed (${status || 'timeout'}): ${msg}`);
      lastError = err;
      // Auth/billing errors — stop trying
      if (status === 401 || status === 403) break;
    }
  }

  console.error('[AI Chatbot] All models failed:', lastError?.message);
  return res.status(500).json({
    success: false,
    message: 'AI service is temporarily unavailable. Please try again in a moment.',
  });
};

/**
 * GET /api/ai-chatbot/test
 */
const testChatbot = async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'GEMINI_API_KEY not set.' });
  }

  const results = [];
  for (const modelName of MODELS) {
    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
        generationConfig: { maxOutputTokens: 10 },
      };
      const reply = await callModel(apiKey, modelName, body, 30000);
      results.push({ model: modelName, status: 'ok', reply });
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

/**
 * GET /api/ai-chatbot/models
 */
const listModels = async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'GEMINI_API_KEY not set.' });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await axios.get(url, { timeout: 15000 });
    const models = (response.data?.models || [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({ name: m.name, displayName: m.displayName }));

    return res.status(200).json({ success: true, count: models.length, models });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err?.response?.data?.error?.message || err?.message,
    });
  }
};

module.exports = { askChatbot, testChatbot, listModels };
