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
    this._statusResetTimer = null;
  }

  render() {
    this.renderShoppingList();
    this.renderSuggestions();
  }

  renderShoppingList() {
    const items = this.app.shoppingList.getAll();
    this.listCountEl.textContent = items.length;

    if (items.length === 0) {
      this.emptyStateEl.style.display = 'flex';
      this.shoppingListEl.innerHTML = '';
      this.shoppingListEl.appendChild(this.emptyStateEl);
      return;
    }

    this.emptyStateEl.style.display = 'none';
    this.shoppingListEl.innerHTML = '';

    const grouped = this.app.shoppingList.groupedByCategory;
    
    for (const [category, categoryItems] of Object.entries(grouped)) {
      const categoryHeader = document.createElement('div');
      categoryHeader.className = 'category-header';
      categoryHeader.textContent = category;
      this.shoppingListEl.appendChild(categoryHeader);

      for (const item of categoryItems) {
        const el = this.createListItemElement(item);
        this.shoppingListEl.appendChild(el);
      }
    }
  }

  createListItemElement(item) {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.dataset.id = item.id;

    div.innerHTML = `
      <div class="item-info">
        <span class="item-name">${this.escapeHtml(item.name)}</span>
        <div class="item-meta">
          <span class="item-category">${this.escapeHtml(item.category)}</span>
        </div>
      </div>
      <span class="item-qty">${item.quantity}<span class="item-unit">${this.escapeHtml(item.unit)}</span></span>
      <div class="item-actions">
        <button class="icon-btn delete" aria-label="Remove ${this.escapeHtml(item.name)}" title="Remove">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;

    div.querySelector('.icon-btn.delete').addEventListener('click', () => {
      this.app.shoppingList.remove(item.id);
      this.renderShoppingList();
      this.app.updateSuggestions();
      this.showToast(`Removed ${item.name}`, 'success');
    });

    return div;
  }

  renderSuggestions(suggestions = this.app.recommendationEngine.getSuggestions()) {
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
        seasonal: 'Seasonal',
        substitute: 'Substitute'
      };

      div.innerHTML = `
        <div class="suggestion-info">
          <div class="suggestion-name">${this.escapeHtml(suggestion.product.name)}</div>
          <div class="suggestion-meta">
            <span class="suggestion-badge">${typeLabels[suggestion.type]}</span>
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
          id: Date.now(),
          name: suggestion.product.name,
          category: suggestion.product.category,
          quantity: 1,
          unit: suggestion.product.size,
          productId: suggestion.product.id
        };
        this.app.shoppingList.add(newItem);
        this.app.recommendationEngine.recordPurchase([newItem]);
        this.renderShoppingList();
        this.renderSuggestions();
        this.showToast(`Added ${suggestion.product.name}`, 'success');
      });

      this.suggestionsListEl.appendChild(div);
    }
  }

  showSearchResults(results, filters) {
    this.searchResultsSectionEl.style.display = 'block';
    this.searchResultsEl.innerHTML = '';

    if (results.length === 0) {
      this.searchResultsEl.innerHTML = '<p class="no-results">No products found for your search.</p>';
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
          id: Date.now(),
          name: product.name,
          category: product.category,
          quantity: 1,
          unit: product.size,
          productId: product.id
        };
        this.app.shoppingList.add(newItem);
        this.app.recommendationEngine.recordPurchase([newItem]);
        this.renderShoppingList();
        this.app.updateSuggestions();
        this.hideSearchResults();
        this.showToast(`Added ${product.name}`, 'success');
      });

      this.searchResultsEl.appendChild(div);
    }

    this.searchResultsEl.scrollIntoView({ behavior: 'smooth' });
  }

  hideSearchResults() {
    this.searchResultsSectionEl.style.display = 'none';
  }

  showRecognizedText(text, isFinal = true) {
    this.recognizedTextEl.innerHTML = `<span class="rt-label">${isFinal ? 'You said' : 'Listening'}</span>${this.escapeHtml(text)}`;
    this.recognizedTextEl.classList.toggle('is-final', isFinal);
    const textCommandEl = document.getElementById('textCommand');
    if (textCommandEl) {
      textCommandEl.value = text;
    }
  }

  setListeningState(listening) {
    this.micButton.setAttribute('aria-label', listening ? 'Stop voice input' : 'Start voice input');
    this.setStatus(listening ? 'listening' : 'idle');
  }

  setStatus(status, label) {
    const labels = {
      idle: 'Tap to speak',
      listening: 'Listening…',
      processing: 'Processing…',
      success: label || 'Got it',
      error: label || "Didn't catch that"
    };

    this.micButton.dataset.status = status;
    this.micStatus.dataset.status = status;
    this.micStatus.querySelector('.status-label').textContent = labels[status] || labels.idle;

    clearTimeout(this._statusResetTimer);
    if (status === 'success' || status === 'error') {
      this._statusResetTimer = setTimeout(() => {
        this.setStatus(this.app.voiceRecognition?.isListening ? 'listening' : 'idle');
      }, 1800);
    }
  }

  showToast(message, type = 'info') {
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
    `;

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}