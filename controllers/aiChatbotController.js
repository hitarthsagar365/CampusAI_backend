const { GoogleGenerativeAI } = require('@google/generative-ai');

// Fallback model list — tries each in order if the previous is unavailable
const FALLBACK_MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.0-flash-exp',
  'gemini-pro',
];

// Remove duplicates while preserving order
const getModelList = () => [...new Set(FALLBACK_MODELS)];

const buildSystemContext = (role) =>
  `You are a helpful assistant for CampusAI, a college management platform. You help users navigate and use the CampusAI application.

The platform has THREE roles:
1. STUDENT: Can view dashboard (attendance summary, assignments, notices, events, timetable), check subject-wise attendance, submit and view assignments, see marks/grades, access study materials/notes, send messages to faculty, manage profile and settings.
2. TEACHER (Faculty): Can view dashboard, manage classes, create and manage assignments, mark student attendance, enter marks in gradebook, upload study materials, post announcements/notices, send messages to students, manage profile and settings.
3. ADMIN: Can manage the entire platform — add/remove students and faculty, manage courses and subjects, manage classes, view/edit attendance and marks, publish notices and events, manage materials and assignments, create and send timetables, and view all messages.

The current user is a ${role.toUpperCase()}.

Guidelines:
- Only answer questions about the CampusAI application and its features.
- If asked something outside CampusAI scope, politely say you can only help with the CampusAI platform.
- Keep answers concise, clear, and actionable.
- Use bullet points for steps when helpful.
- Do not make up features that do not exist in the platform.`;

/**
 * Try each model in the fallback list until one succeeds.
 * Returns { reply, modelUsed } on success or throws the last error.
 */
const tryWithFallback = async (apiKey, systemContext, chatHistory, message) => {
  const models = getModelList();
  let lastError;

  for (const modelName of models) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemContext,
      });

      const chat = model.startChat({ history: chatHistory });
      const result = await chat.sendMessage(message);
      const reply = result.response.text();

      return { reply, modelUsed: modelName };
    } catch (err) {
      const status = err?.message || '';
      const isRetryable =
        status.includes('503') ||
        status.includes('overload') ||
        status.includes('unavailable') ||
        status.includes('high demand') ||
        status.includes('404') ||
        status.includes('not found') ||
        status.includes('no longer available');

      console.warn(`[AI Chatbot] Model "${modelName}" failed: ${err?.message}`);
      lastError = err;

      if (!isRetryable) {
        // Non-retryable error (e.g. bad API key, billing) — stop immediately
        throw err;
      }
      // Retryable — try next model
    }
  }

  throw lastError;
};

/**
 * POST /api/ai-chatbot/ask
 * Body: { message: string, role: 'student' | 'teacher' | 'admin', history: [{role, text}] }
 */
const askChatbot = async (req, res) => {
  try {
    const { message, role = 'student', history = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'AI service is not configured. GEMINI_API_KEY is missing.',
      });
    }

    const systemContext = buildSystemContext(role);

    const chatHistory = history.map((h) => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }],
    }));

    const { reply, modelUsed } = await tryWithFallback(
      apiKey,
      systemContext,
      chatHistory,
      message.trim()
    );

    console.log(`[AI Chatbot] Responded using model: ${modelUsed}`);

    return res.status(200).json({ success: true, reply });
  } catch (error) {
    console.error('AI Chatbot Error (all models failed):', error?.message || error);
    return res.status(500).json({
      success: false,
      message: 'AI service is currently unavailable. Please try again in a moment.',
    });
  }
};

/**
 * GET /api/ai-chatbot/test
 * Open diagnostic — tests each model and reports which one works.
 */
const testChatbot = async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      step: 'env_check',
      message: 'GEMINI_API_KEY is not set in environment variables.',
    });
  }

  const results = [];
  const models = getModelList();

  for (const modelName of models) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('Say "OK" and nothing else.');
      const text = result.response.text();
      results.push({ model: modelName, status: 'ok', reply: text });
      // Found a working model — stop here
      return res.status(200).json({
        success: true,
        keyPrefix: apiKey.substring(0, 8) + '...',
        workingModel: modelName,
        results,
      });
    } catch (err) {
      results.push({ model: modelName, status: 'error', error: err?.message });
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
