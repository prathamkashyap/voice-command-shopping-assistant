const HISTORY_KEY = 'voice_shopping_history';

export class RecommendationEngine {
  constructor(shoppingList, productCatalog) {
    this.shoppingList = shoppingList;
    this.productCatalog = productCatalog;
    this.history = this.loadHistory();
  }

  loadHistory() {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history.slice(-50)));
    } catch (e) {
      console.error('Failed to save history:', e);
    }
  }

  recordPurchase(items) {
    for (const item of items) {
      this.history.push({
        name: item.name,
        category: item.category,
        timestamp: Date.now()
      });
    }
    this.saveHistory();
  }

  getSuggestions() {
    const suggestions = [];
    const currentItems = this.shoppingList.getAll();
    const currentNames = new Set(currentItems.map(i => i.name.toLowerCase()));

    const frequentItems = this.getFrequentItems();
    for (const item of frequentItems) {
      if (!currentNames.has(item.name.toLowerCase())) {
        const product = this.productCatalog.getById(item.productId) || 
                       this.productCatalog.findBestMatch(item.name);
        if (product) {
          suggestions.push({
            type: 'history',
            product,
            reason: `You buy this often`
          });
        }
      }
    }

    const seasonalItems = this.productCatalog.getSeasonal();
    for (const product of seasonalItems.slice(0, 2)) {
      if (!currentNames.has(product.name.toLowerCase())) {
        suggestions.push({
          type: 'seasonal',
          product,
          reason: `In season now`
        });
      }
    }

    for (const item of currentItems) {
      const substitutes = this.productCatalog.getSubstitutes(item.name);
      for (const sub of substitutes.slice(0, 1)) {
        if (!currentNames.has(sub.name.toLowerCase())) {
          suggestions.push({
            type: 'substitute',
            product: sub,
            reason: `Alternative for ${item.name}`
          });
          break;
        }
      }
    }

    return suggestions.slice(0, 4);
  }

  getFrequentItems() {
    const counts = {};
    const recent = this.history.filter(h => 
      Date.now() - h.timestamp < 30 * 24 * 60 * 60 * 1000
    );

    for (const h of recent) {
      const key = h.name.toLowerCase();
      if (!counts[key]) counts[key] = { count: 0, name: h.name, category: h.category };
      counts[key].count++;
    }

    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }
}