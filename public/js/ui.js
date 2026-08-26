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
      const icon = themeBtn.querySelector('.theme-icon');
      if (icon) {
        icon.innerHTML = theme === 'dark' 
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
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
      if (this.emptyStateEl) this.emptyStateEl.style.display = 'flex';
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

    if (this.emptyStateEl) this.emptyStateEl.style.display = 'none';
    this.shoppingListEl.innerHTML = '';

    // Group items by category
    const grouped = {};
    for (const item of items) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }

    for (const [category, categoryItems] of Object.entries(grouped)) {
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
      <label class="item-checkbox-wrap" aria-label="Mark ${this.escapeHtml(item.name)} as completed">
        <input type="checkbox" class="item-checkbox" ${item.completed ? 'checked' : ''}>
        <span class="checkbox-custom"></span>
      </label>
      
      <div class="item-info">
        <span class="item-name">${this.escapeHtml(item.name)}</span>
        <div class="item-meta">
          <span class="item-category">${this.escapeHtml(item.category)}</span>
          ${priceText ? `<span class="item-price-tag">${priceText}</span>` : ''}
        </div>
      </div>

      <div class="item-qty-stepper">
        <button class="qty-btn dec" aria-label="Decrease quantity" title="Decrease">−</button>
        <span class="item-qty">${item.quantity}<span class="item-unit">${this.escapeHtml(item.unit)}</span></span>
        <button class="qty-btn inc" aria-label="Increase quantity" title="Increase">+</button>
      </div>

      <div class="item-actions">
        <button class="icon-btn delete" aria-label="Remove ${this.escapeHtml(item.name)}" title="Remove">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;

    // Checkbox toggle
    div.querySelector('.item-checkbox').addEventListener('change', () => {
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
      this.suggestionsSectionEl.style.display = 'none';
      return;
    }

    this.suggestionsSectionEl.style.display = 'block';
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
          <button class="btn btn-primary btn-sm">Add</button>
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
    
    this.searchResultsSectionEl.style.display = 'block';
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
          <span class="product-price">$${product.price}</span>
          <button class="btn btn-primary btn-sm">Add</button>
        </div>
      `;

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
      this.searchResultsSectionEl.style.display = 'none';
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

  toggleInspector() {
    const panel = document.getElementById('diagnosticsPanel');
    if (!panel) return;
    const isVisible = panel.classList.contains('open');
    panel.classList.toggle('open', !isVisible);
    panel.setAttribute('aria-hidden', String(isVisible));
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
      success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
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
    
    syncStatusEl.dataset.status = status;
    if (syncLabel) {
      const labels = {
        synced: 'Synced',
        syncing: 'Syncing…',
        offline: 'Offline',
        error: 'Sync Error'
      };
      syncLabel.textContent = labels[status] || 'Unknown';
    }
  }
}