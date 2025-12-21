const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

const app = express();


// Настройка CORS: разрешаем DELETE и другие методы
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'UPDATE', 'PUT', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 1. КОНФИГУРАЦИЯ CLOUDINARY
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: 'unida_papers',
      resource_type: 'auto',
      public_id: file.fieldname + '-' + Date.now(),
    };
  },
});
const upload = multer({ storage: storage });

// 2. ПОДКЛЮЧЕНИЕ К БД
mongoose.set('bufferCommands', false);
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('✅ База данных подключена'))
  .catch(err => console.error('❌ Ошибка БД:', err.message));

// 3. МОДЕЛЬ
const Paper = mongoose.model('Paper', new mongoose.Schema({
  title: String,
  desc: String,
  category: String,
  author: String,
  authorAvatar: String,
  pdfUrl: String,
  date: { type: String, default: () => new Date().toLocaleDateString('ru-RU') }
}));

// 4. МАРШРУТЫ (API)

// Получение всех работ
app.get('/api/papers', async (req, res) => {
  try {
    const papers = await Paper.find().sort({ _id: -1 });
    res.json(papers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Публикация работы
app.post('/api/papers', upload.single('file'), async (req, res) => {
  try {
    const newPaper = new Paper({ ...req.body, pdfUrl: req.file.path });
    await newPaper.save();
    res.status(201).json(newPaper);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// УДАЛЕНИЕ РАБОТЫ (Проверьте, что этот блок есть на GitHub!)
app.delete('/api/papers/:id', async (req, res) => {
  try {
    const id = req.params.id;
    console.log('Попытка удаления id:', id);
    
    const result = await Paper.findByIdAndDelete(id);
    
    if (!result) {
      return res.status(404).json({ success: false, message: 'Работа не найдена в базе' });
    }
    
    console.log('✅ Работа удалена успешно');
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Ошибка при удалении:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));


