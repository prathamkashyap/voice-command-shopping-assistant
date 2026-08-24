export class VoiceRecognition {
  constructor({ onStart, onEnd, onError, onResult, onNoSupport }) {
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.onError = onError;
    this.onResult = onResult;
    this.onNoSupport = onNoSupport;
    this.recognition = null;
    this.isListening = false;
    this.initRecognition();
  }

  initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      if (this.onNoSupport) {
        this.onNoSupport();
      }
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      if (this.onStart) this.onStart();
    };

    this.recognition.onend = () => {
      this.isListening = false;
      if (this.onEnd) this.onEnd();
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
      
      if (this.onError) this.onError(message);
    };

    this.recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('');
      
      if (event.results[0].isFinal && this.onResult) {
        this.onResult(transcript);
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