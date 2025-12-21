const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

const app = express();

// Настройка CORS (разрешаем запросы со всех доменов и все методы)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 1. КОНФИГУРАЦИЯ CLOUDINARY
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

// Настройка хранилища с поддержкой PDF
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: 'unida_papers',
      resource_type: 'auto', // Автоматическое определение типа (нужно для PDF)
      public_id: file.fieldname + '-' + Date.now(),
    };
  },
});
const upload = multer({ storage: storage });

// 2. ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ
mongoose.set('bufferCommands', false); // Отключаем буферизацию, чтобы сразу видеть ошибки

mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000 
})
.then(() => console.log('✅ База данных ЮНИДА успешно подключена!'))
.catch(err => {
  console.error('❌ ОШИБКА ПОДКЛЮЧЕНИЯ К БД:', err.message);
});

// 3. СХЕМА ДАННЫХ (ОБНОВЛЕНА)
const paperSchema = new mongoose.Schema({
  title: String,
  desc: String,
  category: String,
  author: String,
  authorAvatar: String,
  pdfUrl: String,
  collaboration: { type: String, default: 'false' }, // ПОЛЕ ДЛЯ ГАЛОЧКИ "ИЩУ СОАВТОРА"
  date: { type: String, default: () => new Date().toLocaleDateString('ru-RU') },
  likes: { type: Number, default: 0 },
  comments: { type: Array, default: [] }
});

const Paper = mongoose.model('Paper', paperSchema);

// 4. ЭНДПОИНТЫ (API)

// Получить все научные работы
app.get('/api/papers', async (req, res) => {
  try {
    const papers = await Paper.find().sort({ _id: -1 });
    res.json(papers);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при получении данных с сервера' });
  }
});

// Опубликовать новую работу
app.post('/api/papers', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл PDF не прикреплен' });
    }

    const newPaper = new Paper({
      title: req.body.title,
      desc: req.body.desc,
      category: req.body.category,
      author: req.body.author,
      authorAvatar: req.body.authorAvatar,
      collaboration: req.body.collaboration, // Сохраняем статус соавторства
      pdfUrl: req.file.path // Ссылка от Cloudinary
    });

    await newPaper.save();
    console.log('🚀 Новая работа опубликована:', newPaper.title);
    res.status(201).json(newPaper);
  } catch (err) {
    console.error('❌ Ошибка при сохранении работы:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Удалить работу
app.delete('/api/papers/:id', async (req, res) => {
  try {
    const result = await Paper.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Работа не найдена' });
    }
    console.log('🗑️ Работа удалена успешно');
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Ошибка при удалении:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5. ЗАПУСК
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`📡 Сервер запущен на порту ${PORT}`);
});
