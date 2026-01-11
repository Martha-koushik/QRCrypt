const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("fileInput");
const qrContainer = document.getElementById("qrContainer");
const qrImage = document.getElementById("qrImage");
const fileLink = document.getElementById("fileLink");
const loadingText = document.getElementById("loadingText");
const progressBar = document.querySelector('.progress-bar');
const progress = document.querySelector('.progress');
const passwordInput = document.getElementById("filePassword");

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  const password = document.getElementById("filePassword").value;
  
  if (!file) {
    alert("Please select a file first!");
    return;
  }

  // Show loading state
  loadingText.style.display = "block";
  qrContainer.style.display = "none";
  progressBar.style.display = "block";
  progress.style.width = "0%";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("password", password);

  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "http://localhost:3000/upload", true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = (event.loaded / event.total) * 100;
        progress.style.width = percentComplete + "%";
      }
    };

    xhr.onload = async function() {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        if (data.qr) {
          qrImage.src = data.qr;
          qrContainer.style.display = "block";
          fileLink.setAttribute('data-fileid', data.fileId);
          fileLink.textContent = "🔗 Open/Download File";
          fileLink.style.display = "inline-block";
          fileLink.onclick = showPasswordPrompt;
        } else {
          throw new Error("Failed to generate QR code");
        }
      } else {
        throw new Error("Upload failed");
      }
    };

    xhr.onerror = () => {
      throw new Error("Network error occurred");
    };

    xhr.send(formData);

  } catch (err) {
    console.error(err);
    alert(`Error: ${err.message || "Unable to upload file or generate QR code."}`);
  } finally {
    loadingText.style.display = "none";
    progressBar.style.display = "none";
  }
});

function showPasswordPrompt(e) {
  e.preventDefault();
  const modal = document.getElementById('passwordPrompt');
  modal.style.display = 'flex';
}

// Update the verifyPassword function:

async function verifyPassword() {
  const password = document.getElementById('downloadPassword').value;
  const fileId = fileLink.getAttribute('data-fileid');
  
  if (!fileId) {
    alert('File ID not found');
    return;
  }

  try {
    const response = await fetch('http://localhost:3000/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fileId, password })
    });

    const data = await response.json();
    
    if (data.success && data.downloadUrl) {
      document.getElementById('passwordPrompt').style.display = 'none';
      window.location.href = data.downloadUrl; // Direct browser to download URL
      document.getElementById('downloadPassword').value = '';
    } else {
      alert(data.message || 'Password verification failed');
    }
  } catch (err) {
    console.error('Verification error:', err);
    alert('Failed to verify password');
  }
}

// Close modal when clicking outside
document.getElementById('passwordPrompt').addEventListener('click', (e) => {
  if (e.target.id === 'passwordPrompt') {
    e.target.style.display = 'none';
    document.getElementById('downloadPassword').value = '';
  }
});

// File input change handler
fileInput.addEventListener('change', () => {
  const fileName = fileInput.files[0]?.name;
  if (fileName) {
    const fileLabel = document.querySelector('.file-label span');
    fileLabel.textContent = fileName;
  }
});

// Theme preference handlers
function saveThemePreference(isDark) {
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function loadThemePreference() {
  const theme = localStorage.getItem('theme');
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
    const themeIcon = document.querySelector('.theme-toggle i');
    themeIcon.classList.remove('fa-moon');
    themeIcon.classList.add('fa-sun');
  }
}

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', loadThemePreference);