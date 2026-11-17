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
      await this.syncManager.init(this.shoppingList);
      if (this.syncManager.isEnabled()) {
        errorTracker.setUserId(this.syncManager.getUserId());
        await this.syncManager.initialSync(this.shoppingList);
      }
      
      let previousSyncStatus = null;
      this.syncManager.onSyncStatusChange((status) => {
        this.ui.setSyncStatus(status);
        if (status === previousSyncStatus) return;
        if (status === 'offline') {
          this.ui.showToast('Offline — changes are saved locally and will sync later', 'warning');
        } else if (status === 'synced' && previousSyncStatus && previousSyncStatus !== 'synced') {
          this.ui.showToast('Back online — shopping list synced', 'success');
        }
        previousSyncStatus = status;
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
    document.getElementById('clearCompleted')?.addEventListener('click', () => this.clearCompleted());
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
        chip.classList.add('is-active');
        setTimeout(() => chip.classList.remove('is-active'), 450);
        chip.blur();
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
    document.getElementById('copyCsvBtn')?.addEventListener('click', () => this.copyCSV());
    document.getElementById('downloadCsvBtn')?.addEventListener('click', () => this.downloadCSV());
    
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

    document.addEventListener('keydown', (e) => {
      const target = e.target;
      const isEditing = target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]');
      if (isEditing) return;

      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('itemSearchInput')?.focus();
      } else if (e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.toggleVoiceInput();
      } else if (e.key === 'Escape') {
        this.ui.toggleInspector(false);
        this.ui.toggleArchModal(false);
        this.ui.toggleExportModal(false);
      }
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

    if (this.handleMetaCommand(text)) {
      this.ui.setStatus('success');
      return;
    }

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
        commandLength: text.length
      });
      this.ui.setStatus('error');
      this.ui.showToast(error.message, 'error');
      this.speak("I couldn't process that command.");
    }
  }

  handleMetaCommand(text) {
    const command = text.toLowerCase().trim();
    const say = (message, type = 'info') => {
      this.ui.showToast(message, type);
      this.speak(message);
    };

    if (/^(?:undo|restore|bring back)\b/.test(command)) {
      if (this.shoppingList.undo()) {
        this.ui.renderShoppingList();
        this.updateSuggestions();
        say('Undo complete', 'success');
      } else {
        say('Nothing to undo', 'warning');
      }
      return true;
    }

    if (/^(?:clear|remove)\s+(?:all\s+)?(?:completed|done|checked)\b/.test(command)) {
      this.clearCompleted();
      return true;
    }

    if (/^(?:clear|empty)\s+(?:all|everything|the\s+list|list)\b/.test(command)) {
      this.clearList();
      return true;
    }

    if (/^(?:what'?s|what is|show|calculate)?\s*(?:the\s+)?(?:total|cost|estimate|budget)\b/.test(command)) {
      const total = this.shoppingList.getEstimatedTotal(this.productCatalog);
      say(`Estimated total is $${total.toFixed(2)}`, 'success');
      return true;
    }

    if (/^(?:help|commands|what can you do)\b/.test(command)) {
      say('Try: add 2 milk, remove bread, find organic under $5, total, undo, clear done', 'info');
      return true;
    }

    if (/^(?:read|what'?s on|show|list)\b.*\blist\b/.test(command)) {
      const items = this.shoppingList.getAll();
      if (items.length === 0) {
        say('Your shopping list is empty', 'info');
      } else {
        const names = items.slice(0, 8).map(item => `${item.quantity} ${item.unit} ${item.name}`).join(', ');
        say(`You have ${items.length} items: ${names}${items.length > 8 ? ', and more' : ''}`, 'info');
      }
      return true;
    }

    return false;
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
      case 'multi': {
        const operations = Array.isArray(intent.operations) && intent.operations.length > 0
          ? intent.operations
          : intent.items.map(item => ({ action: 'add', ...item }));
        for (const operation of operations) {
          const phrase = await this.executeSingleItemCommand(operation.action || 'add', operation);
          if (phrase) speechPhrases.push(phrase);
        }
        break;
      }
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

  async copyCSV() {
    const csv = this.shoppingList.exportAsCSV();
    if (!csv) {
      this.ui.showToast('Nothing to export', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(csv);
      this.ui.showToast('CSV copied to clipboard', 'success');
    } catch {
      this.ui.showToast('Clipboard unavailable — use Download CSV', 'warning');
    }
  }

  downloadCSV() {
    const csv = this.shoppingList.exportAsCSV();
    if (!csv) {
      this.ui.showToast('Nothing to export', 'warning');
      return;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'shopping-list.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    this.ui.showToast('CSV downloaded', 'success');
  }

  clearCompleted() {
    const removedIds = this.shoppingList.clearCompleted();
    if (removedIds.length === 0) return;

    this.ui.renderShoppingList();
    this.updateSuggestions();
    const message = `Cleared ${removedIds.length} completed item${removedIds.length === 1 ? '' : 's'}`;
    this.ui.showToast(message, 'info');
    this.speak(message);
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