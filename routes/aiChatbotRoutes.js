const express = require('express');
const router = express.Router();
const { askChatbot, testChatbot, listModels } = require('../controllers/aiChatbotController');

// GET /api/ai-chatbot/test    — public diagnostic, no auth
router.get('/test', testChatbot);

// GET /api/ai-chatbot/models  — public, lists available models
router.get('/models', listModels);

// POST /api/ai-chatbot/ask    — protected by JWT via server.js
router.post('/ask', askChatbot);

module.exports = router;
