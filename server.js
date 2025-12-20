const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

const app = express();

// Разрешаем запросы с твоего фронтенда
app.use(cors());
app.use(express.json());

// 1. КОНФИГУРАЦИЯ CLOUDINARY
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'unida_papers',
    resource_type: 'auto', // Важно для поддержки PDF
    allowed_formats: ['pdf', 'jpg', 'png']
  },
});
const upload = multer({ storage: storage });

// 2. ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ
mongoose.set('bufferCommands', false); // Отключаем ожидание, чтобы сразу видеть ошибки

mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000 // Ждать только 5 секунд
})
.then(() => console.log('✅ База данных ЮНИДА успешно подключена!'))
.catch(err => {
  console.error('❌ ОШИБКА ПОДКЛЮЧЕНИЯ К БД:', err.message);
});

// 3. СХЕМА ДАННЫХ
const paperSchema = new mongoose.Schema({
  title: String,
  desc: String,
  category: String,
  author: String,
  authorAvatar: String,
  pdfUrl: String,
  date: { type: String, default: () => new Date().toLocaleDateString('ru-RU') },
  likes: { type: Number, default: 0 },
  comments: { type: Number, default: 0 }
});

const Paper = mongoose.model('Paper', paperSchema);

// 4. ЭНДПОИНТЫ (API)

// Получить все работы
app.get('/api/papers', async (req, res) => {
  try {
    const papers = await Paper.find().sort({ _id: -1 });
    res.json(papers);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при получении данных' });
  }
});

// Загрузить новую работу
app.post('/api/papers', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не был загружен' });
    }

    const newPaper = new Paper({
      title: req.body.title,
      desc: req.body.desc,
      category: req.body.category,
      author: req.body.author,
      authorAvatar: req.body.authorAvatar,
      pdfUrl: req.file.path // Ссылка на файл в облаке Cloudinary
    });

    await newPaper.save();
    console.log('✅ Работа опубликована:', newPaper.title);
    res.status(201).json(newPaper);
  } catch (err) {
    console.error('❌ Ошибка публикации:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5. ЗАПУСК СЕРВЕРА
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер ЮНИДА запущен на порту ${PORT}`);
});
