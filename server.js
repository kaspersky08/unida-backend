const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Настройка Cloudinary (Хранилище PDF)
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'unida_papers', allowedFormats: ['pdf', 'jpg', 'png'] },
});
const upload = multer({ storage: storage });

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Юнида подключена к БД'))
  .catch(err => console.error(err));

// Схемы данных
const Paper = mongoose.model('Paper', new mongoose.Schema({
  title: String,
  desc: String,
  category: String,
  author: String,
  authorAvatar: String,
  pdfUrl: String,
  date: { type: String, default: () => new Date().toLocaleDateString('ru-RU') },
  likes: { type: Number, default: 0 },
  comments: { type: Number, default: 0 }
}));

// API Эндпоинты
app.get('/api/papers', async (req, res) => {
  const papers = await Paper.find().sort({ _id: -1 });
  res.json(papers);
});

app.post('/api/papers', upload.single('file'), async (req, res) => {
  const paper = new Paper({
    ...req.body,
    pdfUrl: req.file ? req.file.path : ''
  });
  await paper.save();
  res.status(201).json(paper);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));