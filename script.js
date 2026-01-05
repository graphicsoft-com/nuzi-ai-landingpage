/**
 * Nuzi Demo - Real-Time Transcription
 * Uses NuiqASR library directly for transcription
 */

class NuziDemo {
	constructor() {
		this.currentMode = 'upload';
		this.isRecording = false;
		this.transcriptionText = '';
		this.currentFile = null;
		this.streamingSession = null;
		
		this.init();
	}

	init() {
		this.setupEventListeners();
		this.checkASRAvailability();
	}

	checkASRAvailability() {
		if (!window.NuiqASR) {
			this.showStatus('Transcription service is not available', 'error');
			console.error('NuiqASR is not loaded');
		}
	}

	setupEventListeners() {
		// Mode switching
		document.querySelectorAll('.nuzi-mode-btn').forEach(btn => {
			btn.addEventListener('click', () => this.switchMode(btn.dataset.mode));
		});

		// File upload
		const dropzone = document.getElementById('upload-dropzone');
		const fileInput = document.getElementById('file-input');
		const clearFileBtn = document.getElementById('clear-file-btn');

		fileInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files[0]));
		clearFileBtn.addEventListener('click', () => this.clearFile());

		// Drag and drop
		dropzone.addEventListener('click', () => fileInput.click());
		dropzone.addEventListener('dragover', (e) => {
			e.preventDefault();
			dropzone.classList.add('drag-over');
		});
		dropzone.addEventListener('dragleave', () => {
			dropzone.classList.remove('drag-over');
		});
		dropzone.addEventListener('drop', (e) => {
			e.preventDefault();
			dropzone.classList.remove('drag-over');
			const file = e.dataTransfer.files[0];
			if (file) {
				this.handleFileSelect(file);
			}
		});

		// Microphone - single button for start/stop
		const micButton = document.getElementById('mic-button');
		micButton.addEventListener('click', () => this.toggleRecording());

		// Transcription actions
		document.getElementById('copy-btn').addEventListener('click', () => this.copyTranscription());
		document.getElementById('download-btn').addEventListener('click', () => this.downloadTranscription());
	}

	switchMode(mode) {
		this.currentMode = mode;

		// Update buttons
		document.querySelectorAll('.nuzi-mode-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.mode === mode);
		});

		// Show/hide content
		document.getElementById('upload-mode').style.display = mode === 'upload' ? 'block' : 'none';
		document.getElementById('microphone-mode').style.display = mode === 'microphone' ? 'block' : 'none';

		// Reset transcription
		this.resetTranscription();
	}

	async handleFileSelect(file) {
		if (!file) return;

		// Validate file type
		const validTypes = ['audio/', 'video/'];
		if (!validTypes.some(type => file.type.startsWith(type))) {
			this.showStatus('Please select a valid audio or video file', 'error');
			return;
		}

		this.currentFile = file;
		this.showFileInfo(file);
		
		try {
			await this.transcribeFile(file);
		} catch (error) {
			console.error('Error processing file:', error);
			this.showStatus('Error processing file: ' + error.message, 'error');
		}
	}

	async transcribeFile(file) {
		if (!window.NuiqASR || NuiqASR.isDisabled()) {
			throw new Error('Transcription service is not available');
		}

		this.showStatus('Processing file...', 'info');
		this.showTranscriptionContainer();
		this.showProgressBar();
		this.updateProgress(0);
		this.clearTranscription();

		try {
			// Convert file to audio buffer first
			const audioBuffer = await this.createAudioBuffer(file);

			// Update duration from audio buffer
			if (audioBuffer && audioBuffer.duration) {
				document.getElementById('file-duration').textContent = this.formatDuration(audioBuffer.duration);
			}

			// Use NuiqASR with audio buffer
			let isFirstUpdate = true;
			const self = this;
			const onUpdate = function(data) {
				console.log(data);
				if (isFirstUpdate) {
					self.showStatus('Transcribing...', 'info');
				}
				isFirstUpdate = false;
				self.updateProgress(Math.round(data.progress * 100));
				
				// Show real-time transcription text if available
				if (data.text && data.text.trim().length > 0) {
					self.updateRealtimeTranscription(data.text);
				}
			};

			const transcriptionOptions = {
				audio: audioBuffer,
				diarize: true,
				realtime: true,
				onUpdate
			};

			const asrPromise = NuiqASR.transcribe(transcriptionOptions).catch((data) => {
				console.error('Failed to create NuiqASR promise', data);
				throw new Error('Failed to create transcription promise');
			});

			const asrTranscriptionObj = await asrPromise;

			if (!asrTranscriptionObj) {
				throw new Error('No transcription object returned');
			}

			if (asrTranscriptionObj?.processed === false) {
				throw new Error('Transcription failed, ASR returned processed as false');
			}

			const transcript = asrTranscriptionObj?.text;

			if (transcript && transcript.length > 0) {
				this.displayTranscription(asrTranscriptionObj);
				this.hideProgressBar();
				this.showStatus('Transcription completed!', 'success');

				// Update file duration if available
				if (asrTranscriptionObj.duration) {
					document.getElementById('file-duration').textContent = this.formatDuration(asrTranscriptionObj.duration);
				}
			} else {
				this.hideProgressBar();
				this.showStatus('No words detected in audio', 'error');
				const content = document.getElementById('transcription-content');
				content.innerHTML = '<p class="nuzi-placeholder">No speech detected in audio</p>';
			}

		} catch (error) {
			this.hideProgressBar();
			throw error;
		}
	}

	async createAudioBuffer(file) {
		try {
			// Create audio context
			const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
			
			// Read file as array buffer
			const fileUrl = URL.createObjectURL(file);
			const response = await fetch(fileUrl);
			const arrayBuffer = await response.arrayBuffer();
			
			// Decode to audio buffer
			const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
			
			// Clean up
			URL.revokeObjectURL(fileUrl);
			
			return audioBuffer;
		} catch (error) {
			throw new Error('Failed to create audio buffer: ' + error.message);
		}
	}

	async toggleRecording() {
		if (this.isRecording) {
			this.stopRecording();
		} else {
			await this.startRecording();
		}
	}

	async startRecording() {
		try {
			if (!window.NuiqASR || NuiqASR.isDisabled()) {
				this.showStatus('Transcription service is not available', 'error');
				return;
			}

			// Request microphone permission
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			
			// Create MediaRecorder
			this.mediaRecorder = new MediaRecorder(stream);
			this.isRecording = true;
			
			this.showTranscriptionContainer();
			this.clearTranscription();

			// Update UI - button becomes stop button
			const micButton = document.getElementById('mic-button');
			micButton.classList.add('recording');
			document.getElementById('mic-status').textContent = 'Recording... Click to stop';
			
			this.showStatus('Recording started - speak now', 'success');

			// Setup real-time transcription with NuiqASR
			const self = this;
			const transcriptionOptions = {
				audio: this.mediaRecorder,
				diarize: false,
				realtime: true,
				onUpdate: function(data) {
					if (data.text && data.text.length > 0) {
						self.transcriptionText = data.text;
						self.updateRealtimeTranscription(data.text);
					}
				}
			};

			this.asrPromise = NuiqASR.transcribe(transcriptionOptions).catch((error) => {
				console.error('Failed to create NuiqASR promise', error);
				this.showStatus('Transcription error: ' + (error.message || 'Unknown error'), 'error');
				return null;
			});

			// Start recording
			this.mediaRecorder.start();

		} catch (error) {
			console.error('Error starting recording:', error);
			this.showStatus('Could not access microphone: ' + error.message, 'error');
			this.isRecording = false;
		}
	}

	async stopRecording() {
		if (!this.isRecording) return;

		try {
			// Stop the media recorder
			if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
				this.mediaRecorder.stop();
				this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
			}

			this.isRecording = false;

			// Update UI
			const micButton = document.getElementById('mic-button');
			micButton.classList.remove('recording');
			document.getElementById('mic-status').textContent = 'Processing...';

			// Wait for ASR transcription to complete
			if (this.asrPromise) {
				const asrTranscriptionObj = await this.asrPromise;

				if (!asrTranscriptionObj) {
					throw new Error('No transcription object returned');
				}

				if (asrTranscriptionObj?.processed === false) {
					throw new Error('Transcription failed, ASR returned processed as false');
				}

				const transcript = asrTranscriptionObj.text;

				if (transcript && transcript.length > 0) {
					this.transcriptionText = transcript;
					this.displayTranscription(asrTranscriptionObj);
					this.showStatus('Transcription completed!', 'success');
				} else {
					this.showStatus('No words detected in audio', 'error');
					const content = document.getElementById('transcription-content');
					content.innerHTML = '<p class="nuzi-placeholder">No speech detected</p>';
				}
			}

			document.getElementById('mic-status').textContent = 'Click to start recording';

		} catch (error) {
			console.error('Error stopping recording:', error);
			this.showStatus('Error processing recording: ' + error.message, 'error');
			document.getElementById('mic-status').textContent = 'Click to start recording';
		}
	}

	switchMode(mode) {
		// Stop recording if switching away from microphone mode
		if (this.currentMode === 'microphone' && this.isRecording) {
			this.stopRecording();
		}

		this.currentMode = mode;

		// Update buttons
		document.querySelectorAll('.nuzi-mode-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.mode === mode);
		});

		// Show/hide content
		document.getElementById('upload-mode').style.display = mode === 'upload' ? 'block' : 'none';
		document.getElementById('microphone-mode').style.display = mode === 'microphone' ? 'block' : 'none';

		// Reset transcription
		this.resetTranscription();
	}

	displayTranscription(result) {
		const content = document.getElementById('transcription-content');
		content.innerHTML = '';

		if (!result.text || result.text.trim().length === 0) {
			content.innerHTML = '<p class="nuzi-placeholder">No speech detected in audio</p>';
			return;
		}

		this.transcriptionText = result.text;

		// Display with speaker diarization if available
		if (result.segments && result.segments.length > 0) {
			result.segments.forEach(segment => {
				const segmentDiv = document.createElement('div');
				segmentDiv.className = 'nuzi-transcript-segment';
				
				const speaker = document.createElement('span');
				speaker.className = 'nuzi-speaker-label';
				speaker.textContent = segment.speaker || 'Speaker';
				
				const text = document.createElement('div');
				text.className = 'nuzi-transcript-text';
				text.textContent = segment.text;
				
				segmentDiv.appendChild(speaker);
				segmentDiv.appendChild(text);
				content.appendChild(segmentDiv);
			});
		} else {
			// Display plain text
			const textDiv = document.createElement('div');
			textDiv.className = 'nuzi-transcript-text';
			textDiv.textContent = result.text;
			content.appendChild(textDiv);
		}

		// Scroll to bottom
		content.scrollTop = content.scrollHeight;
	}

	resetTranscription() {
		this.clearTranscription();
		this.hideTranscriptionContainer();
		this.hideProgressBar();
		this.transcriptionText = '';
	}

	updateRealtimeTranscription(text) {
		const content = document.getElementById('transcription-content');
		
		// Remove placeholder if it exists
		const placeholder = content.querySelector('.nuzi-placeholder');
		if (placeholder) {
			placeholder.remove();
		}

		// Clear previous content and show current text
		content.innerHTML = '';
		
		const textDiv = document.createElement('div');
		textDiv.className = 'nuzi-transcript-text';
		textDiv.textContent = text;
		content.appendChild(textDiv);

		// Scroll to bottom
		content.scrollTop = content.scrollHeight;
	}

	showFileInfo(file) {
		document.getElementById('upload-dropzone').style.display = 'none';
		document.getElementById('file-info').style.display = 'flex';
		document.getElementById('file-name').textContent = file.name;
		document.getElementById('file-size').textContent = this.formatFileSize(file.size);
		document.getElementById('file-duration').textContent = 'Processing...';
	}

	clearFile() {
		this.currentFile = null;
		document.getElementById('file-input').value = '';
		document.getElementById('upload-dropzone').style.display = 'block';
		document.getElementById('file-info').style.display = 'none';
		this.resetTranscription();
	}

	showTranscriptionContainer() {
		document.getElementById('transcription-container').style.display = 'block';
	}

	hideTranscriptionContainer() {
		document.getElementById('transcription-container').style.display = 'none';
	}

	showProgressBar() {
		document.getElementById('progress-bar').style.display = 'block';
	}

	hideProgressBar() {
		document.getElementById('progress-bar').style.display = 'none';
	}

	updateProgress(percentage) {
		const fill = document.getElementById('progress-fill');
		const text = document.getElementById('progress-text');
		fill.style.width = percentage + '%';
		text.textContent = percentage + '%';
	}

	clearTranscription() {
		const content = document.getElementById('transcription-content');
		content.innerHTML = '<p class="nuzi-placeholder">Transcribing...</p>';
		this.transcriptionText = '';
	}

	copyTranscription() {
		if (!this.transcriptionText) {
			this.showStatus('No transcription to copy', 'error');
			return;
		}

		navigator.clipboard.writeText(this.transcriptionText).then(() => {
			this.showStatus('Copied to clipboard!', 'success');
		}).catch(err => {
			console.error('Failed to copy:', err);
			this.showStatus('Failed to copy', 'error');
		});
	}

	downloadTranscription() {
		if (!this.transcriptionText) {
			this.showStatus('No transcription to download', 'error');
			return;
		}

		const blob = new Blob([this.transcriptionText], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'nuzi-transcription-' + Date.now() + '.txt';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		this.showStatus('Downloaded transcription', 'success');
	}

	showStatus(message, type = 'info') {
		const statusElement = document.getElementById('status-message');
		statusElement.textContent = message;
		statusElement.className = 'nuzi-status-message ' + type;
		statusElement.style.display = 'block';

		setTimeout(() => {
			statusElement.style.display = 'none';
		}, 3000);
	}

	formatFileSize(bytes) {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
	}

	formatDuration(seconds) {
		const hrs = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		const secs = Math.floor(seconds % 60);
		
		if (hrs > 0) {
			return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
		}
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
	window.nuziDemo = new NuziDemo();
});
