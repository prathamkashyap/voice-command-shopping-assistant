import { ShoppingList } from './shopping-list.js';
import { VoiceRecognition } from './voice-recognition.js';
import { CommandParser } from './command-parser.js';
import { ProductCatalog } from './product-catalog.js';
import { RecommendationEngine } from './recommendation-engine.js';
import { UI } from './ui.js';

class App {
  constructor() {
    this.shoppingList = new ShoppingList();
    this.productCatalog = new ProductCatalog();
    this.recommendationEngine = new RecommendationEngine(this.shoppingList, this.productCatalog);
    this.commandParser = new CommandParser(this.productCatalog);
    this.ui = new UI(this);
    this.voiceRecognition = new VoiceRecognition(this.ui);
    
    this.init();
  }

  async init() {
    await this.productCatalog.load();
    this.shoppingList.load();
    this.ui.render();
    this.setupEventListeners();
    this.updateSuggestions();
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
    
    try {
      const parsed = this.commandParser.parse(text);
      await this.executeCommand(parsed);
    } catch (error) {
      this.ui.showToast(error.message, 'error');
    }
  }

  async executeCommand(parsed) {
    switch (parsed.action) {
      case 'add':
        await this.addItem(parsed);
        break;
      case 'remove':
        await this.removeItem(parsed);
        break;
      case 'modify':
        await this.modifyItem(parsed);
        break;
      case 'search':
        await this.searchProducts(parsed);
        break;
      default:
        throw new Error(`Unknown command: ${parsed.action}`);
    }
  }

  async addItem(parsed) {
    const product = this.productCatalog.findBestMatch(parsed.item);
    const item = {
      id: Date.now(),
      name: product?.name || parsed.item,
      category: product?.category || 'Other',
      quantity: parsed.quantity || 1,
      unit: parsed.unit || (product?.size || 'pcs'),
      productId: product?.id
    };
    
    this.shoppingList.add(item);
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
  }

  async searchProducts(parsed) {
    const results = this.productCatalog.search({
      query: parsed.item,
      brand: parsed.brand,
      maxPrice: parsed.maxPrice,
      category: parsed.category
    });
    
    this.ui.showSearchResults(results, parsed);
  }

  updateSuggestions() {
    const suggestions = this.recommendationEngine.getSuggestions();
    this.ui.renderSuggestions(suggestions);
  }

  clearList() {
    if (this.shoppingList.items.length === 0) return;
    
    if (confirm('Clear entire shopping list?')) {
      this.shoppingList.clear();
      this.ui.showToast('Shopping list cleared', 'info');
      this.updateSuggestions();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

export { App };