class BackgroundBlur {
    constructor(videoElement, canvasElement) {
        this.video = videoElement;
        this.canvas = canvasElement;
        this.context = this.canvas.getContext('2d');
        this.selfieSegmentation = null;
        
        // Add dimensions
        this.canvas.width = 640;  // Default width
        this.canvas.height = 480; // Default height
    }

    // Add method to update input stream
    async updateInputStream(stream) {
        this.video.srcObject = stream;
        this.video.width = this.canvas.width;
        this.video.height = this.canvas.height;
        
        // Wait for video to be ready
        await new Promise((resolve) => {
            this.video.onloadedmetadata = () => {
                this.video.play();
                resolve();
            };
        });
        
        return this.canvas.captureStream();
    }

    async initialize() {
        this.initSelfieSegmentation();
        await this.startCamera();
    }

    initSelfieSegmentation() {
        this.selfieSegmentation = new SelfieSegmentation({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });

        this.selfieSegmentation.setOptions({ modelSelection: 1 }); // Chọn model phân tách nền
        this.selfieSegmentation.onResults(this.onResults.bind(this));
    }

    async startCamera() {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        this.video.srcObject = stream;
        this.video.play();

        requestAnimationFrame(this.processFrame.bind(this));
    }

    async processFrame() {
        if (this.selfieSegmentation && this.video.readyState === 4) {
            await this.selfieSegmentation.send({ image: this.video });
        }
        requestAnimationFrame(this.processFrame.bind(this));
    }

    // Modify onResults to accept custom input
    onResults(results) {
        if (!results || !results.segmentationMask) return;
        
        this.context.save();
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw input image (could be masked or original)
        this.context.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);
        
        // Create temp canvas for blur
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.canvas.width;
        tempCanvas.height = this.canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Apply blur
        tempCtx.filter = 'blur(10px)';
        tempCtx.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);
        
        // Apply mask
        this.context.globalCompositeOperation = 'destination-in';
        this.context.drawImage(results.segmentationMask, 0, 0, this.canvas.width, this.canvas.height);
        
        // Draw blurred background
        this.context.globalCompositeOperation = 'destination-over';
        this.context.drawImage(tempCanvas, 0, 0);
        
        this.context.restore();
    }
}

