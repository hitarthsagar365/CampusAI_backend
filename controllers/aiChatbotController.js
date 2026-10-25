const axios = require('axios');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const buildSystemContext = (role) =>
  `You are a helpful assistant for CampusAI, a college management platform.

Roles:
- STUDENT: Dashboard, attendance, assignments, marks, notes/materials, messages to faculty, profile, settings.
- TEACHER: Dashboard, manage classes, create assignments, mark attendance, gradebook, upload materials, notices, messages.
- ADMIN: Full platform control — students, faculty, courses, subjects, classes, attendance, marks, notices, events, materials, assignments, timetables, messages.

Current user: ${role.toUpperCase()}.
Only answer CampusAI questions. Be concise. Use bullet points for steps.`;

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

  const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
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

  const url = `${GEMINI_BASE}/${modelName}:generateContent?key=${apiKey}`;

  try {
    // 30-second timeout — generous for Render cold starts + Gemini latency
    const response = await axios.post(url, body, { timeout: 30000 });
    const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      return res.status(500).json({ success: false, message: 'AI returned an empty response.' });
    }

    return res.status(200).json({ success: true, reply });
  } catch (err) {
    const errMsg = err?.response?.data?.error?.message || err?.message || 'Unknown error';
    console.error(`[AI Chatbot] ${modelName} error:`, errMsg);
    return res.status(500).json({
      success: false,
      message: 'AI service is temporarily unavailable. Please try again in a moment.',
    });
  }
};

/**
 * GET /api/ai-chatbot/test
 * Tests a single quick call with 30s timeout.
 */
const testChatbot = async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'GEMINI_API_KEY not set.' });
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const url = `${GEMINI_BASE}/${modelName}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
    generationConfig: { maxOutputTokens: 10 },
  };

  try {
    const response = await axios.post(url, body, { timeout: 30000 });
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '(empty)';
    return res.status(200).json({
      success: true,
      model: modelName,
      keyPrefix: apiKey.substring(0, 8) + '...',
      reply: text,
    });
  } catch (err) {
    const errMsg = err?.response?.data?.error?.message || err?.message || 'Unknown';
    return res.status(500).json({
      success: false,
      model: modelName,
      keyPrefix: apiKey.substring(0, 8) + '...',
      error: errMsg,
    });
  }
};

/**
 * GET /api/ai-chatbot/models
 * Lists ALL models available for this API key so we know what actually works.
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
