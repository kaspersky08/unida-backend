/**
 * server.js — расширённый backend
 * - Auth (register/login) + JWT
 * - Papers CRUD (upload PDF to Cloudinary raw)
 * - Avatar upload endpoint (Cloudinary)
 * - News & Events stored in MongoDB
 * - Input validation (express-validator)
 * - Rate limiting, helmet, CORS
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
const { check, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
app.use(express.json());
app.use(helmet());
app.use(compression());

// CORS
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: FRONTEND_URL, credentials: true }));

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
});

// Multer memory storage
const memoryStorage = multer.memoryStorage();
const uploadMemory = multer({ storage: memoryStorage });

// Multer with file filter for PDF (papers)
const uploadPDF = multer({
  storage: memoryStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  }
});

// Multer for avatar images
const uploadImage = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed for avatar'));
  }
});

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/unida';
mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(e => {
    console.error('MongoDB connect error', e);
    process.exit(1);
  });

// Schemas & Models
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

const NewsSchema = new mongoose.Schema({
  title: String,
  desc: String,
  tag: String,
  img: String,
  date: { type: String, default: () => new Date().toLocaleDateString('ru-RU') },
  author: String,
  createdAt: { type: Date, default: Date.now }
});
const News = mongoose.model('News', NewsSchema);

const EventSchema = new mongoose.Schema({
  title: String,
  desc: String,
  type: String,
  day: String,
  month: String,
  location: String,
  createdAt: { type: Date, default: Date.now }
});
const Event = mongoose.model('Event', EventSchema);

// Helpers
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
function generateToken(user) {
  return jwt.sign({ id: user._id, email: user.email, name: user.name, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '30d' });
}

async function uploadBufferToCloudinary(buffer, filename, resource_type = 'raw') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type, public_id: `unida/${path.parse(filename).name}-${Date.now()}-${uuidv4()}` },
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

// Rate limiters
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Too many auth requests, try again later' });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, message: 'Too many uploads, try later' });

// Routes

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Auth: register
app.post('/api/auth/register', authLimiter, [
  check('name').isLength({ min: 2 }).withMessage('Name is required'),
  check('email').isEmail().withMessage('Valid email required'),
  check('password').isLength({ min: 6 }).withMessage('Password min 6 chars')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation error', errors: errors.array() });

    const { name, email, password, institution } = req.body;
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
app.post('/api/auth/login', authLimiter, [
  check('email').isEmail(),
  check('password').exists()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation error', errors: errors.array() });

    const { email, password } = req.body;
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
app.post('/api/papers', authMiddleware, uploadLimiter, uploadPDF.single('file'), [
  check('title').isLength({ min: 1 }).withMessage('Title required'),
  check('author').isLength({ min: 1 }).withMessage('Author required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation error', errors: errors.array() });

    const { title, desc, category, author, authorAvatar, collaboration } = req.body;
    if (!req.file) return res.status(400).json({ message: 'File required' });

    const result = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname, 'raw');

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
    res.status(500).json({ message: 'Upload failed', error: e.message });
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
app.post('/api/papers/:id/comments', authMiddleware, [
  check('text').isLength({ min: 1 }).withMessage('Text required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation error', errors: errors.array() });

    const { text } = req.body;
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

// Avatar upload & update user
app.post('/api/users/avatar', authMiddleware, uploadImage.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'File required' });
    const result = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname, 'image');
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.avatar = result.secure_url;
    await user.save();
    res.json({ ok: true, avatar: user.avatar });
  } catch (e) {
    console.error('avatar upload', e);
    res.status(500).json({ message: 'Avatar upload failed', error: e.message });
  }
});

// NEWS endpoints (persisted)
app.get('/api/news', async (req, res) => {
  try {
    const list = await News.find({}).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (e) {
    console.error('get news', e);
    res.status(500).json({ message: 'Server error' });
  }
});
app.post('/api/news', authMiddleware, [
  check('title').isLength({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    const item = new News({ ...req.body, author: req.user.name, date: new Date().toLocaleDateString('ru-RU') });
    await item.save();
    res.json(item);
  } catch (e) {
    console.error('post news', e);
    res.status(500).json({ message: 'Server error' });
  }
});
app.delete('/api/news/:id', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
    await News.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('delete news', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// EVENTS endpoints (persisted)
app.get('/api/events', async (req, res) => {
  try {
    const list = await Event.find({}).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (e) {
    console.error('get events', e);
    res.status(500).json({ message: 'Server error' });
  }
});
app.post('/api/events', authMiddleware, [
  check('title').isLength({ min: 1 })
], async (req, res) => {
  try {
    const item = new Event(req.body);
    await item.save();
    res.json(item);
  } catch (e) {
    console.error('post event', e);
    res.status(500).json({ message: 'Server error' });
  }
});
app.delete('/api/events/:id', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
    await Event.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('delete event', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error', err && err.stack ? err.stack : err);
  if (err.message && err.message.includes('Only PDF')) {
    return res.status(400).json({ message: err.message });
  }
  res.status(500).json({ message: err.message || 'Server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
