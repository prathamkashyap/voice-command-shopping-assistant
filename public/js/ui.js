import { icon } from './icons.js';

export class UI {
  constructor(app) {
    this.app = app;
    this.shoppingListEl = document.getElementById('shoppingList');
    this.emptyStateEl = document.getElementById('emptyState');
    this.listCountEl = document.getElementById('listCount');
    this.suggestionsSectionEl = document.getElementById('suggestionsSection');
    this.suggestionsListEl = document.getElementById('suggestionsList');
    this.searchResultsSectionEl = document.getElementById('searchResultsSection');
    this.searchResultsEl = document.getElementById('searchResults');
    this.recognizedTextEl = document.getElementById('recognizedText');
    this.micButton = document.getElementById('micButton');
    this.micStatus = document.getElementById('micStatus');
    this.toastContainer = document.getElementById('toastContainer');
    
    // Portfolio elements
    this.budgetTotalEl = document.getElementById('budgetTotal');
    this.completedProgressEl = document.getElementById('completedProgress');
    this.completedLabelEl = document.getElementById('completedLabel');
    this.diagnosticsPanelEl = document.getElementById('diagnosticsPanel');
    this.archModalEl = document.getElementById('archModal');
    this.exportModalEl = document.getElementById('exportModal');

    this._statusResetTimer = null;
    this.initTheme();
    this.initModalDismissal();
  }

  initModalDismissal() {
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          modal.classList.remove('open');
          modal.setAttribute('aria-hidden', 'true');
        }
      });
    });
  }

  initTheme() {
    const savedTheme = localStorage.getItem('voice_shopping_theme') || 
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    this.setTheme(savedTheme);
  }

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('voice_shopping_theme', theme);
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
      themeBtn.setAttribute('title', theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
      themeBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
      const themeIcon = themeBtn.querySelector('.theme-icon');
      if (themeIcon) {
        themeIcon.innerHTML = theme === 'dark' ? icon('sun') : icon('moon');
      }
    }
  }

  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(nextTheme);
  }

  updateTTSToggleUI(enabled) {
    const btn = document.getElementById('ttsToggle');
    if (!btn) return;
    btn.classList.toggle('active', enabled);
    btn.setAttribute('aria-pressed', String(enabled));
    btn.setAttribute('title', enabled ? 'Mute voice feedback' : 'Enable voice feedback');
  }

  render() {
    this.renderShoppingList();
    this.renderSuggestions();
    this.updateCartSummary();
  }

  renderShoppingList() {
    let items = this.app.shoppingList.getAll();
    const totalCount = this.app.shoppingList.totalItems;
    if (this.listCountEl) {
      this.listCountEl.textContent = totalCount;
    }

    // Apply active category filter
    if (this.app.activeCategory && this.app.activeCategory !== 'All') {
      items = items.filter(i => i.category.toLowerCase() === this.app.activeCategory.toLowerCase());
    }

    // Apply search query filter
    if (this.app.itemSearchQuery) {
      const q = this.app.itemSearchQuery;
      items = items.filter(i => 
        i.name.toLowerCase().includes(q) || 
        i.category.toLowerCase().includes(q)
      );
    }

    if (totalCount === 0) {
      if (this.emptyStateEl) this.emptyStateEl.hidden = false;
      this.shoppingListEl.innerHTML = '';
      if (this.emptyStateEl) this.shoppingListEl.appendChild(this.emptyStateEl);
      this.updateCartSummary();
      return;
    }

    if (items.length === 0) {
      this.shoppingListEl.innerHTML = `
        <div class="empty-state">
          <p class="empty-title">No matching items found</p>
          <p class="empty-subtitle">Try clearing your search or filter</p>
        </div>
      `;
      this.updateCartSummary();
      return;
    }

    if (this.emptyStateEl) this.emptyStateEl.hidden = true;
    this.shoppingListEl.innerHTML = '';

    // Group items by category
    const grouped = new Map();
    for (const item of items) {
      const category = item.category || 'Other';
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(item);
    }

    for (const [category, categoryItems] of grouped) {
      const categoryHeader = document.createElement('div');
      categoryHeader.className = 'category-header';
      categoryHeader.innerHTML = `
        <span>${this.escapeHtml(category)}</span>
        <span class="category-count">${categoryItems.length}</span>
      `;
      this.shoppingListEl.appendChild(categoryHeader);

      for (const item of categoryItems) {
        const el = this.createListItemElement(item);
        this.shoppingListEl.appendChild(el);
      }
    }

    this.updateCartSummary();
  }

  updateCartSummary() {
    const totalItems = this.app.shoppingList.totalItems;
    const completedCount = this.app.shoppingList.completedCount;
    const estimatedTotal = this.app.shoppingList.getEstimatedTotal(this.app.productCatalog);

    if (this.budgetTotalEl) {
      this.budgetTotalEl.textContent = `$${estimatedTotal.toFixed(2)}`;
    }

    if (this.completedLabelEl) {
      this.completedLabelEl.textContent = `${completedCount} of ${totalItems} items completed`;
    }

    if (this.completedProgressEl) {
      const percentage = totalItems > 0 ? (completedCount / totalItems) * 100 : 0;
      this.completedProgressEl.style.width = `${percentage}%`;
    }

    const clearCompletedBtn = document.getElementById('clearCompleted');
    if (clearCompletedBtn) {
      clearCompletedBtn.disabled = completedCount === 0;
      clearCompletedBtn.textContent = completedCount > 0 ? `Clear done (${completedCount})` : 'Clear done';
    }
  }

  createListItemElement(item) {
    const div = document.createElement('div');
    div.className = `list-item ${item.completed ? 'completed' : ''}`;
    div.dataset.id = item.id;

    const matchedProduct = item.productId 
      ? this.app.productCatalog.getById(item.productId) 
      : this.app.productCatalog.findBestMatch(item.name);
    
    const priceText = matchedProduct && typeof matchedProduct.price === 'number' 
      ? `$${(matchedProduct.price * item.quantity).toFixed(2)}` 
      : '';

    div.innerHTML = `
      <label class="item-checkbox-wrap">
        <input type="checkbox" class="item-checkbox">
        <span class="checkbox-custom"></span>
      </label>
      
      <div class="item-info">
        <span class="item-name"></span>
        <div class="item-meta">
          <span class="item-category"></span>
          <span class="item-price-tag" hidden></span>
        </div>
      </div>

      <div class="item-qty-stepper">
        <button class="qty-btn dec" aria-label="Decrease quantity" title="Decrease">${icon('minus', 'ui-icon--sm')}</button>
        <span class="item-qty"><span class="item-unit"></span></span>
        <button class="qty-btn inc" aria-label="Increase quantity" title="Increase">${icon('plus', 'ui-icon--sm')}</button>
      </div>

      <div class="item-actions">
        <button class="icon-btn delete" title="Remove">
          ${icon('trash', 'ui-icon--sm')}
        </button>
      </div>
    `;

    div.querySelector('.item-name').textContent = item.name;
    div.querySelector('.item-category').textContent = item.category;
    const price = div.querySelector('.item-price-tag');
    price.textContent = priceText;
    price.hidden = !priceText;
    div.querySelector('.item-qty').prepend(String(item.quantity));
    div.querySelector('.item-unit').textContent = item.unit;
    div.querySelector('.icon-btn.delete').setAttribute('aria-label', `Remove ${item.name}`);

    const checkbox = div.querySelector('.item-checkbox');
    checkbox.checked = Boolean(item.completed);
    checkbox.setAttribute('aria-label', `Mark ${item.name} as completed`);
    checkbox.addEventListener('change', () => {
      this.app.toggleItemCompleted(item.id);
    });

    // Quantity decrement
    div.querySelector('.qty-btn.dec').addEventListener('click', () => {
      this.app.adjustQuantity(item.id, -1);
    });

    // Quantity increment
    div.querySelector('.qty-btn.inc').addEventListener('click', () => {
      this.app.adjustQuantity(item.id, 1);
    });

    // Delete item with undo
    div.querySelector('.icon-btn.delete').addEventListener('click', () => {
      const deletedItem = { ...item };
      this.app.shoppingList.remove(item.id);
      this.renderShoppingList();
      this.app.updateSuggestions();
      this.showToast(`Removed ${item.name}`, 'success', () => {
        this.app.shoppingList.undo();
        this.renderShoppingList();
        this.app.updateSuggestions();
        this.showToast(`Restored ${deletedItem.name}`, 'info');
      });
    });

    return div;
  }

  renderSuggestions(suggestions = this.app.recommendationEngine.getSuggestions()) {
    if (!this.suggestionsSectionEl || !this.suggestionsListEl) return;
    
    if (suggestions.length === 0) {
      this.suggestionsSectionEl.hidden = true;
      return;
    }

    this.suggestionsSectionEl.hidden = false;
    this.suggestionsListEl.innerHTML = '';

    for (const suggestion of suggestions) {
      const div = document.createElement('div');
      div.className = `suggestion-item suggestion-item--${suggestion.type}`;
      
      const typeLabels = {
        history: 'Based on history',
        seasonal: 'Seasonal highlight',
        substitute: 'Smart substitute'
      };

      div.innerHTML = `
        <div class="suggestion-info">
          <div class="suggestion-name">${this.escapeHtml(suggestion.product.name)}</div>
          <div class="suggestion-meta">
            <span class="suggestion-badge">${typeLabels[suggestion.type] || 'Suggestion'}</span>
            <span class="suggestion-reason">${this.escapeHtml(suggestion.reason)}</span>
          </div>
        </div>
        <div class="suggestion-side">
          <span class="suggestion-price">$${suggestion.product.price}</span>
          <button class="btn btn-primary btn-sm">${icon('plus', 'ui-icon--sm')}<span>Add</span></button>
        </div>
      `;

      div.querySelector('button').addEventListener('click', () => {
        const newItem = {
          id: crypto.randomUUID(),
          name: suggestion.product.name,
          category: suggestion.product.category,
          quantity: 1,
          unit: suggestion.product.size,
          productId: suggestion.product.id,
          completed: false
        };
        this.app.shoppingList.add(newItem);
        this.app.recommendationEngine.recordPurchase([newItem]);
        this.renderShoppingList();
        this.renderSuggestions();
        this.showToast(`Added ${suggestion.product.name}`, 'success');
        this.app.speak(`Added ${suggestion.product.name}`);
      });

      this.suggestionsListEl.appendChild(div);
    }
  }

  showSearchResults(results, filters) {
    if (!this.searchResultsSectionEl || !this.searchResultsEl) return;
    
    this.searchResultsSectionEl.hidden = false;
    this.searchResultsEl.innerHTML = '';

    if (results.length === 0) {
      this.searchResultsEl.innerHTML = '<p class="no-results">No products found matching your search.</p>';
      return;
    }

    for (const product of results) {
      const div = document.createElement('div');
      div.className = 'product-card';
      
      div.innerHTML = `
        <div class="product-info">
          <div class="product-name">${this.escapeHtml(product.name)}</div>
          <div class="product-meta">
            <span>${this.escapeHtml(product.brand)}</span>
            <span class="product-meta-dot" aria-hidden="true"></span>
            <span>${this.escapeHtml(product.size)}</span>
            <span class="product-meta-dot" aria-hidden="true"></span>
            <span>${this.escapeHtml(product.category)}</span>
          </div>
        </div>
        <div class="suggestion-side">
          <span class="product-price"></span>
          <button class="btn btn-primary btn-sm">${icon('plus', 'ui-icon--sm')}<span>Add</span></button>
        </div>
      `;

      div.querySelector('.product-price').textContent = `$${product.price}`;
      div.querySelector('button').addEventListener('click', () => {
        const newItem = {
          id: crypto.randomUUID(),
          name: product.name,
          category: product.category,
          quantity: 1,
          unit: product.size,
          productId: product.id,
          completed: false
        };
        this.app.shoppingList.add(newItem);
        this.app.recommendationEngine.recordPurchase([newItem]);
        this.renderShoppingList();
        this.app.updateSuggestions();
        this.hideSearchResults();
        this.showToast(`Added ${product.name}`, 'success');
        this.app.speak(`Added ${product.name}`);
      });

      this.searchResultsEl.appendChild(div);
    }

    this.searchResultsEl.scrollIntoView({ behavior: 'smooth' });
  }

  hideSearchResults() {
    if (this.searchResultsSectionEl) {
      this.searchResultsSectionEl.hidden = true;
    }
  }

  showRecognizedText(text, isFinal = true) {
    if (!this.recognizedTextEl) return;
    this.recognizedTextEl.innerHTML = `<span class="rt-label">${isFinal ? 'You said' : 'Listening…'}</span>${this.escapeHtml(text)}`;
    this.recognizedTextEl.classList.toggle('is-final', isFinal);
    const textCommandEl = document.getElementById('textCommand');
    if (textCommandEl && isFinal) {
      textCommandEl.value = text;
    }
  }

  setListeningState(listening) {
    if (!this.micButton) return;
    this.micButton.setAttribute('aria-label', listening ? 'Stop voice input' : 'Start voice input');
    this.setStatus(listening ? 'listening' : 'idle');
  }

  setStatus(status, label) {
    const labels = {
      idle: 'Tap to speak',
      listening: 'Listening…',
      processing: 'Processing intent…',
      success: label || 'Understood',
      error: label || "Didn't catch that"
    };

    if (this.micButton) this.micButton.dataset.status = status;
    if (this.micStatus) {
      this.micStatus.dataset.status = status;
      const lbl = this.micStatus.querySelector('.status-label');
      if (lbl) lbl.textContent = labels[status] || labels.idle;
    }

    clearTimeout(this._statusResetTimer);
    if (status === 'success' || status === 'error') {
      this._statusResetTimer = setTimeout(() => {
        this.setStatus(this.app.voiceRecognition?.isListening ? 'listening' : 'idle');
      }, 1800);
    }
  }

  updateDiagnostics(intent) {
    if (!intent) return;
    
    const engineBadge = document.getElementById('diagEngine');
    const actionBadge = document.getElementById('diagAction');
    const latencyBadge = document.getElementById('diagLatency');
    const confidenceBadge = document.getElementById('diagConfidence');
    const jsonOutput = document.getElementById('diagJson');

    if (engineBadge) {
      const sourceMap = {
        'rule': 'Rule-Based (Offline)',
        'mock-llm': 'Mock LLM (Local)',
        'llm': 'Cloud LLM',
        'hybrid': 'Hybrid Merger',
        'hybrid-fallback': 'LLM Fallback'
      };
      engineBadge.textContent = sourceMap[intent.source] || intent.source || 'Parser';
    }

    if (actionBadge) {
      actionBadge.textContent = (intent.action || 'Unknown').toUpperCase();
    }

    if (latencyBadge) {
      latencyBadge.textContent = `${intent.latencyMs !== undefined ? intent.latencyMs : '<1'}ms`;
    }

    if (confidenceBadge) {
      const conf = Math.round((intent.confidence || 0.8) * 100);
      confidenceBadge.textContent = `${conf}%`;
    }

    if (jsonOutput) {
      jsonOutput.textContent = JSON.stringify(intent, null, 2);
    }

    // Flash inspector button badge
    const inspBtn = document.getElementById('inspectorToggle');
    if (inspBtn) {
      inspBtn.classList.add('has-update');
      setTimeout(() => inspBtn.classList.remove('has-update'), 2000);
    }
  }

  toggleInspector(isOpen) {
    const panel = document.getElementById('diagnosticsPanel');
    if (!panel) return;
    const shouldOpen = typeof isOpen === 'boolean' ? isOpen : !panel.classList.contains('open');
    panel.classList.toggle('open', shouldOpen);
    panel.setAttribute('aria-hidden', String(!shouldOpen));
  }

  toggleArchModal(isOpen) {
    const modal = document.getElementById('archModal');
    if (!modal) return;
    modal.classList.toggle('open', isOpen);
    modal.setAttribute('aria-hidden', String(!isOpen));
  }

  toggleExportModal(isOpen) {
    const modal = document.getElementById('exportModal');
    if (!modal) return;
    
    if (isOpen) {
      const textPreview = document.getElementById('exportTextPreview');
      if (textPreview) {
        textPreview.value = this.app.shoppingList.exportAsText();
      }
    }
    
    modal.classList.toggle('open', isOpen);
    modal.setAttribute('aria-hidden', String(!isOpen));
  }

  showToast(message, type = 'info', undoCallback = null) {
    if (!this.toastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
      success: icon('check'),
      error: icon('close'),
      warning: icon('warning'),
      info: icon('info')
    };

    toast.innerHTML = `
      ${icons[type] || icons.info}
      <span class="toast-message">${this.escapeHtml(message)}</span>
      ${undoCallback ? '<button class="toast-undo" aria-label="Undo">Undo</button>' : ''}
    `;

    if (undoCallback) {
      toast.querySelector('.toast-undo').addEventListener('click', () => {
        undoCallback();
        toast.style.animation = 'toastIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
      });
    }

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  setSyncStatus(status) {
    const syncStatusEl = document.getElementById('syncStatus');
    const syncLabel = syncStatusEl?.querySelector('.sync-label');
    if (!syncStatusEl) return;

    const pendingCount = this.app.syncManager?.getPendingOperationCount?.() || 0;
    syncStatusEl.dataset.status = status;
    if (syncLabel) {
      const labels = {
        'local-only': 'Local only',
        'local-items': 'Local items',
        connecting: 'Connecting…',
        synced: pendingCount > 0 ? `Syncing ${pendingCount}` : 'Synced',
        syncing: 'Syncing…',
        offline: pendingCount > 0 ? `Offline • ${pendingCount}` : 'Offline',
        error: 'Sync Error'
      };
      syncLabel.textContent = labels[status] || 'Unknown';
    }
    const descriptions = {
      'local-only': 'Shopping list is stored on this device',
      'local-items': 'Some items are only stored on this device',
      connecting: 'Connecting to cloud sync',
      offline: 'Offline — changes are queued locally',
      error: 'Sync encountered an error'
    };
    syncStatusEl.title = descriptions[status] || 'Firestore real-time sync status';
  }
}
