const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * POST /api/ai-chatbot/ask
 * Body: { message: string, role: 'student' | 'teacher' | 'admin', history: [{role, text}] }
 *
 * Calls Google Gemini API and returns an AI response scoped to the CampusAI application.
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
        message: 'AI service is not configured. Please set GEMINI_API_KEY.',
      });
    }

    // System context — scopes the AI strictly to CampusAI features
    const systemContext = `You are a helpful assistant for CampusAI, a college management platform. You help users navigate and use the CampusAI application.

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

    const genAI = new GoogleGenerativeAI(apiKey);

    // Pass systemInstruction at model level — correct for SDK v0.21+ including v0.24
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      systemInstruction: systemContext,
    });

    // Build conversation history for multi-turn context
    const chatHistory = history.map((h) => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }],
    }));

    const chat = model.startChat({
      history: chatHistory,
    });

    const result = await chat.sendMessage(message.trim());
    const responseText = result.response.text();

    return res.status(200).json({
      success: true,
      reply: responseText,
    });

  } catch (error) {
    console.error('AI Chatbot Error:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get AI response. Please try again.',
    });
  }
};

module.exports = { askChatbot };
