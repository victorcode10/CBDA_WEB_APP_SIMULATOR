const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

// IMPORTANT: Set port from environment or default
const PORT = process.env.PORT || 5000;


const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));


// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure required directories exist
const dirs = ['data', 'data/questions', 'data/results', 'data/users', 'uploads'];
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Initialize default admin user
const initializeAdmin = () => {
  const usersPath = path.join(__dirname, 'data', 'users.json');
  if (!fs.existsSync(usersPath)) {
    const defaultUsers = [
      {
        id: 'admin_001',
        name: 'Admin User',
        email: 'victor@blossom.africa',
        password: bcrypt.hashSync('admin123', 10),
        role: 'admin',
        createdAt: new Date().toISOString(),
        verified: true
      },
      {
        id: 'student_001',
        name: 'Victor Bolade',
        email: 'victorboladea@gmail.com',
        password: bcrypt.hashSync('student123', 10),
        role: 'student',
        createdAt: new Date().toISOString(),
        verified: true
      }
    ];
    fs.writeFileSync(usersPath, JSON.stringify(defaultUsers, null, 2));
    console.log('✅ Default users created');
  }
};

initializeAdmin();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON and image files are allowed'));
    }
  }
});

// ==================== AUTHENTICATION ROUTES ====================

// Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const usersPath = path.join(__dirname, 'data', 'users.json');
    
    if (!fs.existsSync(usersPath)) {
      return res.status(404).json({ success: false, error: 'No users found' });
    }

    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    const user = users.find(u => u.email === email);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const isValidPassword = bcrypt.compareSync(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Don't send password back
    const { password: _, ...userWithoutPassword } = user;
    res.json({ success: true, user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Register
app.post('/api/auth/register', (req, res) => {
  try {
    const { name, email, password } = req.body;
    const usersPath = path.join(__dirname, 'data', 'users.json');

    let users = [];
    if (fs.existsSync(usersPath)) {
      users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    }

    // Check if user exists
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ success: false, error: 'Email already registered' });
    }

    const newUser = {
      id: `student_${Date.now()}`,
      name,
      email,
      password: bcrypt.hashSync(password, 10),
      role: 'student',
      createdAt: new Date().toISOString(),
      verified: false
    };

    users.push(newUser);
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

    const { password: _, ...userWithoutPassword } = newUser;
    res.json({ success: true, user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== QUESTION ROUTES ====================

// Upload questions for a specific test (chapter or mock)
app.post('/api/questions/upload/:testType/:testId', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { testType, testId } = req.params; // e.g., "chapter/1" or "mock/1"
    const fileContent = fs.readFileSync(req.file.path, 'utf8');
    let questions;

    try {
      questions = JSON.parse(fileContent);
    } catch (parseError) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'Invalid JSON format' });
    }

    // Validate questions
    if (!Array.isArray(questions)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'Questions must be an array' });
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.id || !q.question || !Array.isArray(q.options) || 
          q.options.length !== 4 || typeof q.correctAnswer !== 'number') {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ 
          success: false, 
          error: `Invalid question format at index ${i}. Required: id, question, options (4), correctAnswer (0-3)` 
        });
      }
    }

    // Save questions
    const questionsDir = path.join(__dirname, 'data', 'questions');
    const filename = `${testType}_${testId}.json`;
    const questionsPath = path.join(questionsDir, filename);

    fs.writeFileSync(questionsPath, JSON.stringify(questions, null, 2));
    fs.unlinkSync(req.file.path); // Clean up uploaded file

    console.log(`✅ ${questions.length} questions uploaded for ${testType} ${testId}`);
    res.json({ 
      success: true, 
      message: 'Questions uploaded successfully',
      count: questions.length,
      testType,
      testId
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get questions for a specific test
app.get('/api/questions/:testType/:testId', (req, res) => {
  try {
    const { testType, testId } = req.params;
    const filename = `${testType}_${testId}.json`;
    const questionsPath = path.join(__dirname, 'data', 'questions', filename);

    if (!fs.existsSync(questionsPath)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Questions not found for this test' 
      });
    }

    const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));
    
    // Shuffle questions for randomization
    const shuffled = questions.sort(() => Math.random() - 0.5);

    res.json({ 
      success: true, 
      questions: shuffled,
      count: shuffled.length 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all available tests (admin)
app.get('/api/questions/available', (req, res) => {
  try {
    const questionsDir = path.join(__dirname, 'data', 'questions');
    const files = fs.readdirSync(questionsDir);
    
    const availableTests = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const [testType, testId] = f.replace('.json', '').split('_');
        const content = JSON.parse(fs.readFileSync(path.join(questionsDir, f), 'utf8'));
        return {
          testType,
          testId,
          questionCount: content.length,
          filename: f
        };
      });

    res.json({ success: true, tests: availableTests });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== RESULTS ROUTES ====================

// Save test result
app.post('/api/results', (req, res) => {
  try {
    const result = req.body;

    if (!result.userName || !result.testName || result.score === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: userName, testName, score' 
      });
    }

    const resultsPath = path.join(__dirname, 'data', 'results', 'all_results.json');
    let results = [];

    if (fs.existsSync(resultsPath)) {
      results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    }

    const newResult = {
      ...result,
      id: `result_${Date.now()}`,
      timestamp: new Date().toISOString()
    };

    results.push(newResult);
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

    console.log(`✅ Result saved: ${result.userName} - ${result.testName} - ${result.score}%`);
    res.json({ success: true, resultId: newResult.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get results for a specific user
app.get('/api/results/user/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const resultsPath = path.join(__dirname, 'data', 'results', 'all_results.json');

    if (!fs.existsSync(resultsPath)) {
      return res.json({ success: true, results: [], count: 0 });
    }

    let results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    results = results.filter(r => r.userId === userId);
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ success: true, results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all results (admin only)
app.get('/api/results/admin/all', (req, res) => {
  try {
    const resultsPath = path.join(__dirname, 'data', 'results', 'all_results.json');

    if (!fs.existsSync(resultsPath)) {
      return res.json({ success: true, results: [], count: 0 });
    }

    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Calculate stats
    const stats = {
      totalTests: results.length,
      uniqueStudents: [...new Set(results.map(r => r.userId))].length,
      averageScore: results.length > 0 
        ? Math.round(results.reduce((acc, r) => acc + r.score, 0) / results.length) 
        : 0,
      passRate: results.length > 0
        ? Math.round((results.filter(r => r.score >= 70).length / results.length) * 100)
        : 0
    };

    res.json({ success: true, results, count: results.length, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export results to CSV
app.get('/api/results/export/csv', (req, res) => {
  try {
    const resultsPath = path.join(__dirname, 'data', 'results', 'all_results.json');

    if (!fs.existsSync(resultsPath)) {
      return res.status(404).send('No results to export');
    }

    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

    // Create CSV
    let csv = 'ID,User Name,User Email,Test Name,Test Type,Score (%),Date,Time Taken,Total Questions,Correct Answers,User ID,Timestamp\n';

    results.forEach(r => {
      csv += `"${r.id}","${r.userName}","${r.userEmail || 'N/A'}","${r.testName}","${r.testType || 'N/A'}",${r.score},"${r.date}","${r.timeTaken}",${r.totalQuestions},${r.correctAnswers},"${r.userId}","${r.timestamp}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=cbda-results-${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a result (admin only)
app.delete('/api/results/:resultId', (req, res) => {
  try {
    const { resultId } = req.params;
    const resultsPath = path.join(__dirname, 'data', 'results', 'all_results.json');

    if (!fs.existsSync(resultsPath)) {
      return res.status(404).json({ success: false, error: 'No results found' });
    }

    let results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    const initialLength = results.length;
    
    results = results.filter(r => r.id !== resultId);

    if (results.length === initialLength) {
      return res.status(404).json({ success: false, error: 'Result not found' });
    }

    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    res.json({ success: true, message: 'Result deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ADMIN ROUTES ====================

// Upload logo
app.post('/api/admin/upload-logo', upload.single('logo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No logo uploaded' });
    }

    const publicDir = path.join(__dirname, '..', 'public');
    const logoPath = path.join(publicDir, 'logo.png');

    // Backup existing logo
    if (fs.existsSync(logoPath)) {
      const backupPath = path.join(publicDir, `logo-backup-${Date.now()}.png`);
      fs.copyFileSync(logoPath, backupPath);
    }

    fs.copyFileSync(req.file.path, logoPath);
    fs.unlinkSync(req.file.path);

    console.log('✅ Logo uploaded successfully');
    res.json({ success: true, message: 'Logo uploaded successfully' });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all users (admin only)
app.get('/api/admin/users', (req, res) => {
  try {
    const usersPath = path.join(__dirname, 'data', 'users.json');
    
    if (!fs.existsSync(usersPath)) {
      return res.json({ success: true, users: [], count: 0 });
    }

    let users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    
    // Remove passwords
    users = users.map(({ password, ...user }) => user);

    res.json({ success: true, users, count: users.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get dashboard stats (admin)
app.get('/api/admin/stats', (req, res) => {
  try {
    const resultsPath = path.join(__dirname, 'data', 'results', 'all_results.json');
    const usersPath = path.join(__dirname, 'data', 'users.json');
    const questionsDir = path.join(__dirname, 'data', 'questions');

    let stats = {
      totalStudents: 0,
      totalTests: 0,
      averageScore: 0,
      passRate: 0,
      totalQuestions: 0,
      availableTests: 0
    };

    // Count users
    if (fs.existsSync(usersPath)) {
      const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
      stats.totalStudents = users.filter(u => u.role === 'student').length;
    }

    // Count tests and calculate scores
    if (fs.existsSync(resultsPath)) {
      const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      stats.totalTests = results.length;
      
      if (results.length > 0) {
        stats.averageScore = Math.round(
          results.reduce((acc, r) => acc + r.score, 0) / results.length
        );
        stats.passRate = Math.round(
          (results.filter(r => r.score >= 70).length / results.length) * 100
        );
      }
    }

    // Count available questions
    if (fs.existsSync(questionsDir)) {
      const files = fs.readdirSync(questionsDir).filter(f => f.endsWith('.json'));
      stats.availableTests = files.length;
      
      files.forEach(file => {
        const content = JSON.parse(fs.readFileSync(path.join(questionsDir, file), 'utf8'));
        stats.totalQuestions += content.length;
      });
    }

    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Server running', 
    timestamp: new Date().toISOString(),
    storage: 'Local JSON files'
  });
});


const { uploadCSVToFirebase, listCSVFiles, deleteCSVFile } = require('./config/firebase-storage');

// ==================== CSV CLOUD STORAGE ROUTES ====================

// Export results to CSV and upload to cloud
app.get('/api/results/export/csv-cloud', async (req, res) => {
  try {
    const resultsPath = path.join(__dirname, 'data', 'results', 'all_results.json');

    if (!fs.existsSync(resultsPath)) {
      return res.status(404).json({ success: false, error: 'No results to export' });
    }

    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

    // Create CSV
    let csv = 'ID,User Name,User Email,Test Name,Test Type,Score (%),Date,Time Taken,Total Questions,Correct Answers,User ID,Timestamp\n';

    results.forEach(r => {
      csv += `"${r.id}","${r.userName}","${r.userEmail || 'N/A'}","${r.testName}","${r.testType || 'N/A'}",${r.score},"${r.date}","${r.timeTaken}",${r.totalQuestions},${r.correctAnswers},"${r.userId}","${r.timestamp}"\n`;
    });

    // Upload to Firebase Storage
    const filename = `cbda-results-${Date.now()}.csv`;
    const uploadResult = await uploadCSVToFirebase(csv, filename);

    if (uploadResult.success) {
      res.json({
        success: true,
        message: 'CSV uploaded to cloud storage',
        url: uploadResult.url,
        filename: uploadResult.filename
      });
    } else {
      // If cloud upload fails, still allow local download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      res.send(csv);
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// List all uploaded CSV files in cloud
app.get('/api/results/csv-files', async (req, res) => {
  try {
    const result = await listCSVFiles();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete CSV file from cloud
app.delete('/api/results/csv-cloud/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const result = await deleteCSVFile(filename);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.post('/api/auth/change-email', (req, res) => {
  try {
    const { userId, newEmail } = req.body;
    const usersPath = path.join(__dirname, 'data', 'users.json');

    if (!fs.existsSync(usersPath)) {
      return res.status(404).json({ success: false, error: 'Users not found' });
    }

    let users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    
    // Check if new email already exists
    if (users.find(u => u.email === newEmail && u.id !== userId)) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }

    // Update email
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    users[userIndex].email = newEmail;
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

    res.json({ success: true, message: 'Email updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

//const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 ========================================`);
  console.log(`   CBDA Exam Simulator Backend`);
  console.log(`   ========================================`);
  console.log(`   ✅ Server running on http://localhost:${PORT}`);
  console.log(`   💾 Storage: Local JSON files`);
  console.log(`   📁 Data location: ${path.join(__dirname, 'data')}`);
  console.log(`   ========================================\n`);
});
