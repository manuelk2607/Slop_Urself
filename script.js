const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');

imageInput.addEventListener('change', function(event) {
    const file = event.target.files[0];
    const customButton = document.querySelector('.custom-file-btn');

    if (file) {
        imagePreview.src = URL.createObjectURL(file);
        imagePreview.style.display = 'block';

        customButton.innerText = '📸 Anderes Bild auswählen';
    } else {
        imagePreview.style.display = 'none';
        imagePreview.src = '';
        customButton.innerText = '📸 Bild auswählen';
    }
});

const uploadButton = document.getElementById('uploadButton');
const loadingSection = document.getElementById('loadingSection');
const videoPlayer = document.getElementById('videoPlayer');

uploadButton.addEventListener('click', function () {
    if (!imageInput.files[0]) {
        alert('Bitte wähle zuerst ein Bild aus!');
        return;
    }
    uploadButton.disabled = true;
    uploadButton.innerText = 'Wird generiert...';
    loadingSection.style.display = 'flex';
    videoPlayer.style.display = 'none';

    setTimeout(function () {
        loadingSection.style.display = 'none';
        uploadButton.disabled = false;
        uploadButton.innerText = 'KI-Video generieren';

        videoPlayer.src = 'https://www.w3schools.com/html/mov_bbb.mp4';
        videoPlayer.style.display = 'block';
    }, 10);
});