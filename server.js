/**
 * server.js
 * Express + MongoDB backend with:
 * - Auth (register/login) + JWT
 * - Papers CRUD (upload PDF to Cloudinary raw)
 * - Comments on papers
 * - CORS
 *
 * Required env:
 * - MONGODB_URI
 * - JWT_SECRET
 * - CLOUDINARY_CLOUD_NAME
 * - CLOUDINARY_API_KEY
 * - CLOUDINARY_API_SECRET
 * - FRONTEND_URL (optional)
 * - PORT (optional)
 */
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
app.use(express.json());

// CORS
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: FRONTEND_URL, credentials: true }));

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
});

// Multer memory storage for immediate upload to Cloudinary
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/unida';
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(e => {
    console.error('MongoDB connect error', e);
    process.exit(1);
  });

// Schemas
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, sparse: true },
  passwordHash: String,
  institution: String,
  avatar: String,
  isAdmin: { type: Boolean, default: false },
  bio: String,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const CommentSchema = new mongoose.Schema({
  author: String,
  avatar: String,
  text: String,
  time: { type: Date, default: Date.now }
});

const PaperSchema = new mongoose.Schema({
  title: String,
  desc: String,
  category: String,
  author: String,
  authorAvatar: String,
  pdfUrl: String,
  cloudinary_public_id: String,
  collaboration: { type: Boolean, default: false },
  likes: { type: Number, default: 0 },
  comments: [CommentSchema],
  date: { type: Date, default: Date.now }
});
const Paper = mongoose.model('Paper', PaperSchema);

// Helpers
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
function generateToken(user) {
  return jwt.sign({ id: user._id, email: user.email, name: user.name, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '30d' });
}

async function uploadBufferToCloudinary(buffer, filename) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'raw', public_id: `papers/${path.parse(filename).name}-${Date.now()}-${uuidv4()}` },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// Routes

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Auth: register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, institution } = req.body;
    if (!email || !password || !name) return res.status(400).json({ message: 'Missing fields' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=76935C&color=fff`;
    const user = new User({ name, email, passwordHash, institution: institution || '', avatar });
    await user.save();

    const token = generateToken(user);
    return res.json({ user: { name: user.name, email: user.email, institution: user.institution, avatar: user.avatar, isAdmin: user.isAdmin }, token });
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Auth: login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Missing fields' });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) return res.status(400).json({ message: 'Invalid credentials' });

    const token = generateToken(user);
    return res.json({ user: { name: user.name, email: user.email, institution: user.institution, avatar: user.avatar, isAdmin: user.isAdmin }, token });
  } catch (e) {
    console.error('login error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET papers
app.get('/api/papers', async (req, res) => {
  try {
    const papers = await Paper.find({}).sort({ date: -1 }).lean();
    res.json(papers);
  } catch (e) {
    console.error('get papers', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST paper (upload PDF) - auth required
app.post('/api/papers', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { title, desc, category, author, authorAvatar, collaboration } = req.body;
    if (!req.file) return res.status(400).json({ message: 'File required' });

    // Upload to Cloudinary as raw
    const result = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname);

    const paper = new Paper({
      title,
      desc,
      category,
      author,
      authorAvatar,
      pdfUrl: result.secure_url,
      cloudinary_public_id: result.public_id,
      collaboration: collaboration === 'true' || collaboration === true,
      likes: 0,
      comments: []
    });
    await paper.save();
    res.json(paper);
  } catch (e) {
    console.error('upload paper', e);
    res.status(500).json({ message: 'Upload failed' });
  }
});

// DELETE paper - only author or admin
app.delete('/api/papers/:id', authMiddleware, async (req, res) => {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper) return res.status(404).json({ message: 'Not found' });

    const isAuthor = req.user.name === paper.author;
    const isAdmin = req.user.isAdmin;
    if (!isAuthor && !isAdmin) return res.status(403).json({ message: 'Forbidden' });

    // delete from cloudinary if exists
    if (paper.cloudinary_public_id) {
      try {
        await cloudinary.uploader.destroy(paper.cloudinary_public_id, { resource_type: 'raw' });
      } catch (err) {
        console.warn('Cloudinary destroy warning', err.message || err);
      }
    }
    await paper.remove();
    res.json({ ok: true });
  } catch (e) {
    console.error('delete paper', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST comment to paper
app.post('/api/papers/:id/comments', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'Text required' });
    const paper = await Paper.findById(req.params.id);
    if (!paper) return res.status(404).json({ message: 'Not found' });

    paper.comments.push({ author: req.user.name, avatar: req.user.avatar || '', text, time: new Date() });
    await paper.save();
    res.json({ ok: true, comments: paper.comments });
  } catch (e) {
    console.error('post comment', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// Simple endpoints for news/events (store in memory or extend to DB)
// For simplicity: store in-memory arrays here (if you want persistence, move to Mongo collections)
let newsStore = [];
let eventsStore = [];

app.get('/api/news', (req, res) => res.json(newsStore));
app.post('/api/news', authMiddleware, (req, res) => {
  const item = { ...req.body, id: Date.now(), date: new Date().toLocaleDateString('ru-RU') };
  newsStore.unshift(item);
  res.json(item);
});
app.get('/api/events', (req, res) => res.json(eventsStore));
app.post('/api/events', authMiddleware, (req, res) => {
  const item = { ...req.body, id: Date.now() };
  eventsStore.unshift(item);
  res.json(item);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
