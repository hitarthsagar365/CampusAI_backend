const express = require('express');
const router = express.Router();
const { askChatbot, testChatbot } = require('../controllers/aiChatbotController');

// GET /api/ai-chatbot/test  — no auth needed, open diagnostic endpoint
router.get('/test', testChatbot);

// POST /api/ai-chatbot/ask  — protected by JWT via server.js
router.post('/ask', askChatbot);

module.exports = router;
