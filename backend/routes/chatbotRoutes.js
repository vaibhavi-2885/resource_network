const express = require('express');
const router = express.Router();
const { chat } = require('../controllers/chatbotController');

router.post('/message', chat);

module.exports = router;
