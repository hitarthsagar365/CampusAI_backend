const express = require('express');
const router = express.Router();
const { askChatbot } = require('../controllers/aiChatbotController');

// POST /api/ai-chatbot/ask
// Protected — requires valid JWT (user must be logged in)
router.post('/ask', askChatbot);

module.exports = router;
