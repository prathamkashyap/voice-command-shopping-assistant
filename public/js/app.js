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
    this.ui = new UI(this);
    this.voiceRecognition = new VoiceRecognition({
      onStart: () => this.ui.setListeningState(true),
      onEnd: () => this.ui.setListeningState(false),
      onError: (message) => this.ui.showToast(message, 'error'),
      onResult: (transcript) => this.handleVoiceResult(transcript),
      onNoSupport: () => {
        this.ui.showToast('Speech recognition not supported in this browser', 'warning');
        document.getElementById('micButton').disabled = true;
        document.getElementById('micStatus').textContent = 'Voice input not supported';
      }
    });
    
    // Initialize error tracking
    this.initErrorTracking();
    
    this.init();
  }

  initErrorTracking() {
    // Initialize error tracker
    errorTracker.setUserId(this.syncManager.getUserId() || 'anonymous');
    
    // Override console.error to capture errors
    const originalError = console.error;
    console.error = (...args) => {
      originalError.apply(console, args);
      const error = args.find(arg => arg instanceof Error);
      if (error) {
        captureException(error, { source: 'console.error' });
      }
    };
    
    // Capture unhandled promise rejections globally
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
        // Set user ID in error tracker after auth
        errorTracker.setUserId(this.syncManager.getUserId());
        await this.syncManager.initialSync(this.shoppingList);
      }
      
      // Register sync status callback
      this.syncManager.onSyncStatusChange((status) => {
        this.ui.setSyncStatus(status);
      });
    } catch (error) {
      captureException(error, { source: 'initializeSync' });
      console.warn('Sync initialization failed:', error.message);
    }
    
    // Register service worker
    this.registerServiceWorker();
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('[App] Service Worker registered:', registration.scope);
        
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this.ui.showToast('New version available! Refresh to update.', 'info');
            }
          });
        });
        
        // Listen for messages from service worker
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

  handleVoiceResult(transcript) {
    this.ui.showRecognizedText(transcript);
    this.processCommand(transcript);
  }

  setupEventListeners() {
    document.getElementById('micButton').addEventListener('click', () => this.toggleVoiceInput());
    document.getElementById('sendCommand').addEventListener('click', () => this.handleTextCommand());
    document.getElementById('textCommand').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleTextCommand();
    });
    document.getElementById('clearList').addEventListener('click', () => this.clearList());
    document.getElementById('closeSearch').addEventListener('click', () => this.ui.hideSearchResults());
    document.getElementById('language').addEventListener('change', (e) => {
      this.voiceRecognition.setLanguage(e.target.value);
    });
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
    const text = input.value.trim();
    if (!text) return;
    
    input.value = '';
    await this.processCommand(text);
  }

  async processCommand(text) {
    this.ui.showRecognizedText(text);
    this.ui.setStatus('processing');

    try {
      const locale = document.getElementById('language')?.value || 'en-US';
      const intent = await this.intentParser.parse(text, locale);
      await this.executeIntent(intent);
      this.ui.setStatus('success');
    } catch (error) {
      captureException(error, { 
        source: 'processCommand', 
        command: text 
      });
      this.ui.setStatus('error');
      this.ui.showToast(error.message, 'error');
    }
  }

  async executeIntent(intent) {
    switch (intent.action) {
      case 'add':
      case 'remove':
      case 'modify':
        for (const item of intent.items) {
          await this.executeSingleItemCommand(intent.action, item);
        }
        break;
      case 'multi':
        for (const item of intent.items) {
          await this.executeSingleItemCommand('add', item);
        }
        break;
      case 'search':
        await this.searchProducts(intent.searchFilters);
        break;
      default:
        throw new Error(`Unknown action: ${intent.action}`);
    }

    if (intent.action !== 'search') {
      this.ui.renderShoppingList();
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
        await this.addItem(parsed);
        break;
      case 'remove':
        await this.removeItem(parsed);
        break;
      case 'modify':
        await this.modifyItem(parsed);
        break;
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
      productId: product?.id
    };
    
    this.shoppingList.add(item);
    this.recommendationEngine.recordPurchase([item]);
    this.ui.showToast(`Added ${item.quantity} ${item.unit} of ${item.name}`, 'success');
    this.updateSuggestions();
  }

  async removeItem(parsed) {
    const item = this.shoppingList.findByName(parsed.item);
    if (!item) {
      throw new Error(`${parsed.item} not found in your list`);
    }
    
    this.shoppingList.remove(item.id);
    this.ui.showToast(`Removed ${item.name}`, 'success');
    this.updateSuggestions();
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
    this.ui.showToast(`Updated ${item.name} to ${item.quantity} ${item.unit}`, 'success');
    this.updateSuggestions();
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
      this.updateSuggestions();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

export { App };