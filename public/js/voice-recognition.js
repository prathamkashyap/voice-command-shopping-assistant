export class VoiceRecognition {
  constructor(ui) {
    this.ui = ui;
    this.recognition = null;
    this.isListening = false;
    this.initRecognition();
  }

  initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      this.ui.showToast('Speech recognition not supported in this browser', 'warning');
      document.getElementById('micButton').disabled = true;
      document.getElementById('micStatus').textContent = 'Voice input not supported';
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.ui.setListeningState(true);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.ui.setListeningState(false);
    };

    this.recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      let message = 'Voice input error';
      
      switch (event.error) {
        case 'no-speech':
          message = 'No speech detected. Please try again.';
          break;
        case 'audio-capture':
          message = 'Microphone not accessible';
          break;
        case 'not-allowed':
          message = 'Microphone permission denied';
          break;
        case 'network':
          message = 'Network error occurred';
          break;
      }
      
      this.ui.showToast(message, 'error');
    };

    this.recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('');
      
      this.ui.showRecognizedText(transcript, event.results[0].isFinal);
      
      if (event.results[0].isFinal) {
        this.ui.app.processCommand(transcript);
      }
    };
  }

  start() {
    if (!this.recognition) return;
    
    try {
      this.recognition.start();
    } catch (e) {
      if (e.name === 'InvalidStateError') {
        this.recognition.stop();
        setTimeout(() => this.recognition.start(), 100);
      }
    }
  }

  stop() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
  }

  setLanguage(lang) {
    if (this.recognition) {
      this.recognition.lang = lang;
    }
  }
}