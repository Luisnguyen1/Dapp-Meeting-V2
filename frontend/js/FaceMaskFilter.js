class FaceMaskFilter {
  constructor(videoElement, canvasElement, maskImageElement) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.context = this.canvas.getContext('2d');
    this.maskImage = maskImageElement;
    this.faceMesh = null;
    this.camera = null;
  }

  async initialize() {
    this.initFaceMesh();
    await this.startCamera();
  }

  initFaceMesh() {
    this.faceMesh = new FaceMesh({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
      }
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.faceMesh.onResults(this.onResults.bind(this));
  }

  async startCamera() {
    this.camera = new Camera(this.video, {
      onFrame: async () => {
        await this.faceMesh.send({image: this.video});
      },
      width: 640,
      height: 480
    });
    await this.camera.start();
  }

  async processFrame(inputStream) {
    // Create temporary video element to handle input stream
    const tempVideo = document.createElement('video');
    tempVideo.srcObject = inputStream;
    await tempVideo.play();

    // Process frame with face mesh
    await this.faceMesh.send({image: tempVideo});

    // Return processed stream from canvas
    return this.canvas.captureStream();
  }

  onResults(results) {
    this.context.save();
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);

    if (results.multiFaceLandmarks) {
      for (const landmarks of results.multiFaceLandmarks) {
        this.drawMask(landmarks);
      }
    }
    this.context.restore();
  }

  drawMask(landmarks) {
    // Check if current mask is medical type
    const isMedicalMask = this.maskImage.src.includes('medicel/');
    
    if (isMedicalMask) {
      this.drawMedicalMask(landmarks);
    } else {
      this.drawBasicMask(landmarks);
    }
  }

  // Existing mask drawing logic renamed to drawBasicMask
  drawBasicMask(landmarks) {
    const leftEar = landmarks[234];
    const rightEar = landmarks[454];
    const chin = landmarks[199];
    const bottomChin = landmarks[175];
    const noseBridge = landmarks[6];
    const foreHead = landmarks[10];

    const faceWidth = Math.sqrt(
      Math.pow((rightEar.x - leftEar.x) * this.canvas.width, 2) +
      Math.pow((rightEar.y - leftEar.y) * this.canvas.height, 2)
    );
    
    const faceHeight = Math.sqrt(
      Math.pow((bottomChin.y - foreHead.y) * this.canvas.height, 2) +
      Math.pow((bottomChin.x - foreHead.x) * this.canvas.width, 2)
    );

    const angle = Math.atan2(
      (rightEar.y - leftEar.y) * this.canvas.height,
      (rightEar.x - leftEar.x) * this.canvas.width
    );

    this.context.save();

    const centerX = noseBridge.x * this.canvas.width;
    const centerY = (noseBridge.y * 0.6 + bottomChin.y * 0.4) * this.canvas.height;
    this.context.translate(centerX, centerY);
    this.context.rotate(angle);

    const maskWidth = faceWidth * 1.4;
    const maskHeight = faceHeight * 1.5;
    this.context.drawImage(
      this.maskImage,
      -maskWidth / 2,
      -maskHeight / 2,
      maskWidth,
      maskHeight
    );

    this.context.restore();
  }

  // Add new method for medical mask
  drawMedicalMask(landmarks) {
    // Landmarks for medical mask positioning
    const noseTip = landmarks[1];        // Tip of nose
    const leftCheek = landmarks[234];    // Left cheek
    const rightCheek = landmarks[454];   // Right cheek
    const chin = landmarks[152];         // Bottom of chin

    // Calculate mask dimensions
    const faceWidth = Math.sqrt(
      Math.pow((rightCheek.x - leftCheek.x) * this.canvas.width, 2) +
      Math.pow((rightCheek.y - leftCheek.y) * this.canvas.height, 2)
    );

    const maskHeight = Math.sqrt(
      Math.pow((chin.y - noseTip.y) * this.canvas.height, 2) +
      Math.pow((chin.x - noseTip.x) * this.canvas.width, 2)
    ) * 1.2; // Slightly larger than nose-to-chin distance

    // Calculate angle for mask rotation
    const angle = Math.atan2(
      (rightCheek.y - leftCheek.y) * this.canvas.height,
      (rightCheek.x - leftCheek.x) * this.canvas.width
    );

    this.context.save();

    // Position mask centered on nose tip
    const centerX = noseTip.x * this.canvas.width;
    const centerY = noseTip.y * this.canvas.height;
    
    this.context.translate(centerX, centerY);
    this.context.rotate(angle);

    // Draw mask slightly wider than face width
    const maskWidth = faceWidth * 1.2;
    this.context.drawImage(
      this.maskImage,
      -maskWidth / 2,
      0, // Start from nose tip
      maskWidth,
      maskHeight
    );

    this.context.restore();
  }
}

// // Khởi tạo khi bấm nút Start
// document.getElementById('startButton').addEventListener('click', async () => {
//   document.getElementById('startButton').style.display = 'none';
//   document.getElementById('video').style.display = 'block';
//   document.getElementById('canvas').style.display = 'block';

//   const faceMaskFilter = new FaceMaskFilter(
//     document.getElementById('video'),
//     document.getElementById('canvas'),
//     document.getElementById('maskImage')
//   );
  
//   await faceMaskFilter.initialize();
// });