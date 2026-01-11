const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// Initialize file store
const fileStore = new Map();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const fileId = crypto.randomBytes(16).toString('hex');
    cb(null, `${fileId}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Get local IP address
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();
console.log(`Server will be accessible at: ${localIP}`);

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileId = req.file.filename.split('-')[0];
    const password = req.body.password || '';
    const filePath = req.file.path;

    // Store file information
    fileStore.set(fileId, {
      path: filePath,
      password: password,
      originalName: req.file.originalname,
      attempts: 0,
      lastAttempt: null,
      downloadToken: null,
      tokenExpiry: null,
      uploadTime: Date.now()
    });

    console.log(`File uploaded: ${fileId} with password: ${password ? 'Yes' : 'No'}`);

    // Generate QR code with fileId
    const qrCode = await QRCode.toDataURL(`http://${localIP}:${PORT}/download/${fileId}`);
    
    res.json({
      success: true,
      qr: qrCode,
      fileId: fileId
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

// Verify endpoint
app.post('/verify', (req, res) => {
  console.log('Verify request received:', req.body);
  const { fileId, password } = req.body;
  const fileInfo = fileStore.get(fileId);

  if (!fileInfo) {
    console.log(`File not found: ${fileId}`);
    return res.json({ success: false, message: 'File not found' });
  }

  // Rate limiting
  const now = Date.now();
  if (fileInfo.lastAttempt && (now - fileInfo.lastAttempt) < 2000) {
    return res.json({ success: false, message: 'Please wait before trying again' });
  }

  fileInfo.attempts = (fileInfo.attempts || 0) + 1;
  fileInfo.lastAttempt = now;

  if (fileInfo.attempts > 5) {
    return res.json({ success: false, message: 'Too many attempts. Please try again later' });
  }

  if (fileInfo.password === password) {
    // Generate download token
    const downloadToken = crypto.randomBytes(32).toString('hex');
    fileInfo.downloadToken = downloadToken;
    fileInfo.tokenExpiry = Date.now() + (30 * 60 * 1000); // 30 minutes
    fileInfo.attempts = 0;

    console.log(`Token generated for file: ${fileId}`);
    
    res.json({ 
      success: true, 
      downloadUrl: `http://${localIP}:${PORT}/download/${fileId}?token=${downloadToken}`
    });
  } else {
    console.log(`Invalid password attempt for file: ${fileId}`);
    res.json({ success: false, message: 'Invalid password' });
  }
});

// Share page - shows QR and sharing actions
app.get('/share/:fileId', async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const fileInfo = fileStore.get(fileId);
    if (!fileInfo) return res.status(404).send('File not found');

    const fileUrl = `http://${localIP}:${PORT}/download/${fileId}`;
    const qrDataUrl = await QRCode.toDataURL(fileUrl);
    const originalName = fileInfo.originalName || 'file';

    res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <title>Share ${originalName}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            img { max-width: 320px; height: auto; }
            .actions { margin-top: 12px; }
            button, a { margin-right: 8px; margin-bottom: 8px; }
            input[type=text] { width: 100%; padding: 8px; margin-top: 8px; box-sizing: border-box; }
          </style>
        </head>
        <body>
          <h2>Share: ${originalName}</h2>
          <img id="qr" src="${qrDataUrl}" alt="QR code"/>
          <div class="actions">
            <a id="downloadQr" href="${qrDataUrl}" download="${fileId}.png">Download QR</a>
            <button id="copyLink">Copy Download Link</button>
            <a id="openDownload" href="${fileUrl}" target="_blank">Open Download Page</a>
            <a id="whatsapp" href="https://wa.me/?text=${encodeURIComponent(fileUrl)}" target="_blank">Share on WhatsApp</a>
            <a id="mailto" href="mailto:?subject=${encodeURIComponent('File share')}&body=${encodeURIComponent('Download link: ' + fileUrl)}">Send Email</a>
          </div>
          <label>Direct link (share this):</label>
          <input type="text" id="directLink" value="${fileUrl}" readonly />
          <p id="msg" style="color:green"></p>
          <script>
            document.getElementById('copyLink').addEventListener('click', async () => {
              try {
                await navigator.clipboard.writeText(document.getElementById('directLink').value);
                document.getElementById('msg').textContent = 'Link copied to clipboard';
                setTimeout(() => document.getElementById('msg').textContent = '', 3000);
              } catch (e) {
                document.getElementById('msg').textContent = 'Copy failed';
              }
            });
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Share page error:', err);
    res.status(500).send('Failed to generate share page');
  }
});

// Download endpoint
app.get('/download/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const token = req.query.token;
  const fileInfo = fileStore.get(fileId);

  console.log(`Download endpoint hit for file: ${fileId} with token: ${token}`);

  if (!fileInfo) {
    return res.status(404).send('File not found or expired');
  }

  // If no token provided, serve a password entry page that calls /verify
  if (!token) {
    const originalName = fileInfo.originalName || 'file';
    return res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <title>Enter password to download ${originalName}</title>
        </head>
        <body>
          <h2>Download: ${originalName}</h2>
          <form id="pwForm">
            <label>Password: <input type="password" name="password" id="password" required /></label>
            <button type="submit">Verify & Download</button>
          </form>
          <p id="msg" style="color:red"></p>
          <script>
            const form = document.getElementById('pwForm');
            const msg = document.getElementById('msg');
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              msg.textContent = '';
              const password = document.getElementById('password').value;
              try {
                const resp = await fetch('/verify', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fileId: '${fileId}', password })
                });
                const data = await resp.json();
                if (data.success && data.downloadUrl) {
                  // redirect to the download URL (contains token)
                  window.location = data.downloadUrl;
                } else {
                  msg.textContent = data.message || 'Invalid password';
                }
              } catch (err) {
                msg.textContent = 'Request failed';
              }
            });
          </script>
        </body>
      </html>
    `);
  }

  // if token is present proceed with existing checks and download
  if (!fileInfo.downloadToken) {
    return res.status(403).send('Please verify password first');
  }

  if (fileInfo.downloadToken !== token) {
    return res.status(403).send('Invalid download token');
  }

  if (Date.now() > fileInfo.tokenExpiry) {
    delete fileInfo.downloadToken;
    delete fileInfo.tokenExpiry;
    return res.status(403).send('Download token has expired. Please verify password again');
  }

  const filePath = fileInfo.path;
  if (!fs.existsSync(filePath)) {
    fileStore.delete(fileId);
    return res.status(404).send('File no longer exists');
  }

  res.download(filePath, fileInfo.originalName, (err) => {
    if (err) {
      console.error('Download error:', err);
      return res.status(500).send('Error downloading file');
    }
    console.log(`File downloaded successfully: ${fileId}`);
    delete fileInfo.downloadToken;
    delete fileInfo.tokenExpiry;
    fileInfo.attempts = 0;
  });
});

// Cleanup job - runs every hour
setInterval(() => {
  const now = Date.now();
  for (const [fileId, fileInfo] of fileStore.entries()) {
    // Remove files older than 24 hours
    if (now - fileInfo.uploadTime > 24 * 60 * 60 * 1000) {
      try {
        fs.unlinkSync(fileInfo.path);
        fileStore.delete(fileId);
        console.log(`Cleaned up expired file: ${fileId}`);
      } catch (err) {
        console.error(`Cleanup error for file ${fileId}:`, err);
      }
    }
  }
}, 60 * 60 * 1000);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at: http://${localIP}:${PORT}`);
  console.log('Upload directory:', uploadDir);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  // Clean up uploads directory
  if (fs.existsSync(uploadDir)) {
    fs.readdirSync(uploadDir).forEach(file => {
      fs.unlinkSync(path.join(uploadDir, file));
    });
  }
  process.exit(0);
});