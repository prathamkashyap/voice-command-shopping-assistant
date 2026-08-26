import { ShoppingList } from './shopping-list.js';
import { VoiceRecognition } from './voice-recognition.js';
import { HybridIntentParser } from './hybrid-parser.js';
import { ProductCatalog } from './product-catalog.js';
import { RecommendationEngine } from './recommendation-engine.js';
import { UI } from './ui.js';
import { syncManager } from './sync-manager.js';
import { errorTracker, captureException, captureMessage } from './error-tracker.js';

class App {
  constructor() {
    this.syncManager = syncManager;
    this.shoppingList = new ShoppingList(this.syncManager);
    this.productCatalog = new ProductCatalog();
    this.recommendationEngine = new RecommendationEngine(this.shoppingList, this.productCatalog);
    this.intentParser = new HybridIntentParser(this.productCatalog, {
      useMockLLM: false,
      llmEnabled: true,
      fallbackToLLM: true,
      apiEndpoint: '/api/parse-intent'
    });
    
    // Voice feedback & diagnostics state
    this.ttsEnabled = localStorage.getItem('voice_shopping_tts') !== 'false';
    this.lastIntent = null;
    this.activeCategory = 'All';
    this.itemSearchQuery = '';

    this.ui = new UI(this);
    this.voiceRecognition = new VoiceRecognition({
      onStart: () => this.ui.setListeningState(true),
      onEnd: () => this.ui.setListeningState(false),
      onError: (message) => {
        this.ui.showToast(message, 'error');
        this.speak('Sorry, there was an error with voice recognition.');
      },
      onInterimResult: (transcript) => this.ui.showRecognizedText(transcript, false),
      onResult: (transcript) => this.handleVoiceResult(transcript),
      onNoSupport: () => {
        this.ui.showToast('Speech recognition not supported in this browser', 'warning');
        const micBtn = document.getElementById('micButton');
        if (micBtn) micBtn.disabled = true;
        const micStatus = document.getElementById('micStatus');
        if (micStatus) micStatus.textContent = 'Voice input not supported';
      }
    });
    
    // Initialize error tracking
    this.initErrorTracking();
    this.init();
  }

  initErrorTracking() {
    errorTracker.setUserId(this.syncManager.getUserId() || 'anonymous');
    
    const originalError = console.error;
    console.error = (...args) => {
      originalError.apply(console, args);
      const error = args.find(arg => arg instanceof Error);
      if (error) {
        captureException(error, { source: 'console.error' });
      }
    };
    
    window.addEventListener('unhandledrejection', (event) => {
      captureException(event.reason, { type: 'unhandled_rejection' });
    });
  }

  async init() {
    try {
      await this.productCatalog.load();
    } catch (error) {
      this.ui.showToast('Failed to load product catalog. Some features may not work.', 'error');
      console.error('Product catalog load error:', error);
    }
    this.shoppingList.load();
    this.ui.render();
    this.setupEventListeners();
    this.updateSuggestions();
    this.initializeSync();
  }

  async initializeSync() {
    try {
      await this.syncManager.init();
      if (this.syncManager.isEnabled()) {
        errorTracker.setUserId(this.syncManager.getUserId());
        await this.syncManager.initialSync(this.shoppingList);
      }
      
      this.syncManager.onSyncStatusChange((status) => {
        this.ui.setSyncStatus(status);
      });
    } catch (error) {
      captureException(error, { source: 'initializeSync' });
      console.warn('Sync initialization failed:', error.message);
    }
    
    this.registerServiceWorker();
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('[App] Service Worker registered:', registration.scope);
        
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this.ui.showToast('New version available! Refresh to update.', 'info');
            }
          });
        });
        
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'SYNC_COMPLETE') {
            this.ui.showToast('Sync completed', 'success');
          }
        });
      } catch (error) {
        console.warn('[App] Service Worker registration failed:', error);
      }
    }
  }

  speak(text) {
    if (!this.ttsEnabled || !('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      const lang = document.getElementById('language')?.value || 'en-US';
      utterance.lang = lang;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('TTS playback error:', e);
    }
  }

  toggleTTS() {
    this.ttsEnabled = !this.ttsEnabled;
    localStorage.setItem('voice_shopping_tts', String(this.ttsEnabled));
    this.ui.updateTTSToggleUI(this.ttsEnabled);
    this.ui.showToast(this.ttsEnabled ? 'Voice feedback enabled' : 'Voice feedback muted', 'info');
  }

  handleVoiceResult(transcript) {
    this.ui.showRecognizedText(transcript, true);
    this.processCommand(transcript);
  }

  setupEventListeners() {
    document.getElementById('micButton')?.addEventListener('click', () => this.toggleVoiceInput());
    document.getElementById('sendCommand')?.addEventListener('click', () => this.handleTextCommand());
    document.getElementById('textCommand')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleTextCommand();
    });
    document.getElementById('clearList')?.addEventListener('click', () => this.clearList());
    document.getElementById('closeSearch')?.addEventListener('click', () => this.ui.hideSearchResults());
    document.getElementById('language')?.addEventListener('change', (e) => {
      this.voiceRecognition.setLanguage(e.target.value);
    });

    // Quick Command chips delegation
    document.querySelectorAll('.prompt-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const text = chip.dataset.prompt || chip.textContent.trim();
        const input = document.getElementById('textCommand');
        if (input) input.value = text;
        this.processCommand(text);
      });
    });

    // Theme toggle
    document.getElementById('themeToggle')?.addEventListener('click', () => this.ui.toggleTheme());
    // TTS toggle
    document.getElementById('ttsToggle')?.addEventListener('click', () => this.toggleTTS());
    // AI Inspector toggle
    document.getElementById('inspectorToggle')?.addEventListener('click', () => this.ui.toggleInspector());
    // Architecture Modal toggle
    document.getElementById('archModalToggle')?.addEventListener('click', () => this.ui.toggleArchModal(true));
    // Export Modal toggle
    document.getElementById('exportListBtn')?.addEventListener('click', () => this.ui.toggleExportModal(true));
    
    // Category tabs delegation
    document.getElementById('categoryFilters')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-filter-btn');
      if (btn) {
        this.setCategoryFilter(btn.dataset.category || 'All');
      }
    });

    // List item live search
    document.getElementById('itemSearchInput')?.addEventListener('input', (e) => {
      this.itemSearchQuery = e.target.value.toLowerCase().trim();
      this.ui.renderShoppingList();
    });
  }

  setCategoryFilter(category) {
    this.activeCategory = category;
    document.querySelectorAll('.cat-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.category === category);
    });
    this.ui.renderShoppingList();
  }

  toggleVoiceInput() {
    if (this.voiceRecognition.isListening) {
      this.voiceRecognition.stop();
    } else {
      this.voiceRecognition.start();
    }
  }

  async handleTextCommand() {
    const input = document.getElementById('textCommand');
    const text = input?.value.trim();
    if (!text) return;
    
    if (input) input.value = '';
    await this.processCommand(text);
  }

  async processCommand(text) {
    this.ui.showRecognizedText(text, true);
    this.ui.setStatus('processing');

    try {
      const locale = document.getElementById('language')?.value || 'en-US';
      const intent = await this.intentParser.parse(text, locale);
      this.lastIntent = intent;
      this.ui.updateDiagnostics(intent);
      
      await this.executeIntent(intent);
      this.ui.setStatus('success');
    } catch (error) {
      captureException(error, { 
        source: 'processCommand', 
        command: text 
      });
      this.ui.setStatus('error');
      this.ui.showToast(error.message, 'error');
      this.speak("I couldn't process that command.");
    }
  }

  async executeIntent(intent) {
    const speechPhrases = [];

    switch (intent.action) {
      case 'add':
      case 'remove':
      case 'modify':
        for (const item of intent.items) {
          const phrase = await this.executeSingleItemCommand(intent.action, item);
          if (phrase) speechPhrases.push(phrase);
        }
        break;
      case 'multi':
        for (const item of intent.items) {
          const phrase = await this.executeSingleItemCommand('add', item);
          if (phrase) speechPhrases.push(phrase);
        }
        break;
      case 'search':
        await this.searchProducts(intent.searchFilters);
        speechPhrases.push(`Found search results for ${intent.searchFilters.query || 'products'}`);
        break;
      default:
        throw new Error(`Unknown action: ${intent.action}`);
    }

    if (intent.action !== 'search') {
      this.ui.renderShoppingList();
    }

    if (speechPhrases.length > 0) {
      this.speak(speechPhrases.join('. '));
    }
  }

  async executeSingleItemCommand(action, itemData) {
    const parsed = {
      action,
      item: itemData.item,
      quantity: itemData.quantity,
      unit: itemData.unit
    };

    switch (action) {
      case 'add':
        return await this.addItem(parsed);
      case 'remove':
        return await this.removeItem(parsed);
      case 'modify':
        return await this.modifyItem(parsed);
    }
  }

  async addItem(parsed) {
    const product = this.productCatalog.findBestMatch(parsed.item);
    const item = {
      id: crypto.randomUUID(),
      name: product?.name || parsed.item,
      category: product?.category || 'Other',
      quantity: parsed.quantity || 1,
      unit: parsed.unit || (product?.size || 'pcs'),
      productId: product?.id,
      completed: false
    };
    
    this.shoppingList.add(item);
    this.recommendationEngine.recordPurchase([item]);
    const message = `Added ${item.quantity} ${item.unit} of ${item.name}`;
    this.ui.showToast(message, 'success');
    this.updateSuggestions();
    return message;
  }

  async removeItem(parsed) {
    const item = this.shoppingList.findByName(parsed.item);
    if (!item) {
      throw new Error(`${parsed.item} not found in your list`);
    }
    
    this.shoppingList.remove(item.id);
    const message = `Removed ${item.name}`;
    this.ui.showToast(message, 'success');
    this.updateSuggestions();
    return message;
  }

  async modifyItem(parsed) {
    const item = this.shoppingList.findByName(parsed.item);
    if (!item) {
      throw new Error(`${parsed.item} not found in your list`);
    }
    
    if (parsed.quantity !== undefined) {
      item.quantity = parsed.quantity;
    }
    if (parsed.unit) {
      item.unit = parsed.unit;
    }
    
    this.shoppingList.update(item);
    const message = `Updated ${item.name} to ${item.quantity} ${item.unit}`;
    this.ui.showToast(message, 'success');
    this.updateSuggestions();
    return message;
  }

  async searchProducts(searchFilters) {
    const results = this.productCatalog.search({
      query: searchFilters.query,
      brand: searchFilters.brand,
      maxPrice: searchFilters.maxPrice,
      category: searchFilters.category,
      isOrganic: searchFilters.isOrganic
    });
    
    this.ui.showSearchResults(results, searchFilters);
  }

  toggleItemCompleted(id) {
    const item = this.shoppingList.toggleCompleted(id);
    if (item) {
      this.ui.renderShoppingList();
    }
  }

  adjustQuantity(id, delta) {
    const updated = this.shoppingList.incrementQuantity(id, delta);
    this.ui.renderShoppingList();
    this.updateSuggestions();
  }

  updateSuggestions() {
    const suggestions = this.recommendationEngine.getSuggestions();
    this.ui.renderSuggestions(suggestions);
  }

  clearList() {
    if (this.shoppingList.items.length === 0) return;
    
    if (confirm('Clear entire shopping list?')) {
      this.shoppingList.clear();
      this.ui.renderShoppingList();
      this.ui.showToast('Shopping list cleared', 'info');
      this.speak('Shopping list cleared');
      this.updateSuggestions();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

export { App };