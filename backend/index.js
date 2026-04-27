const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http'); // 🚀 NEW: Required for Socket.io
const { Server } = require('socket.io'); // 🚀 NEW: Real-time engine

// --- 1. IMPORT ROUTES ---
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes'); 
const donationRoutes = require('./routes/donationRoutes'); 
const chatbotRoutes = require('./routes/chatbotRoutes');

dotenv.config();
const app = express();

// Create HTTP Server
const server = http.createServer(app); 

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // Your Frontend URL
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.json());
app.use(cors());

// --- 2. REGISTER ROUTES ---
app.use('/api/auth', authRoutes); 
app.use('/api/admin', adminRoutes); 
app.use('/api/donations', donationRoutes); 
app.use('/api/chatbot', chatbotRoutes);

// --- 3. SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
  console.log('📡 Real-time tracker active for device:', socket.id);

  // Users join a room named after their User ID for private updates
  socket.on('join_user_room', (userId) => {
    socket.join(userId);
    console.log(`👤 Donor ${userId} is now listening for live updates.`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Tracker disconnected');
  });
});

// Make 'io' accessible in our controllers so we can emit from there
app.set('socketio', io);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

app.get("/", (req, res) => {
  res.send("AI Donation System API with Live Tracker is working!");
});

// Database Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully!"))
  .catch((err) => console.log("❌ MongoDB Connection Error: ", err));

// 🏁 IMPORTANT: We now listen via 'server', not 'app'
server.listen(PORT, () => {
  console.log(`🚀 Server & Live Engine running on http://localhost:${PORT}`);
});
