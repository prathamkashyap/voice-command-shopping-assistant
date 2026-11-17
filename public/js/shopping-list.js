const STORAGE_KEY = 'voice_shopping_list';
const UNDO_KEY = 'voice_shopping_undo';

export class ShoppingList {
  constructor(syncManager = null) {
    this.items = [];
    this.lastDeletedItem = null;
    this.syncManager = syncManager;
  }

  load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.items = JSON.parse(stored).filter(item => item && !item.deleted);
      }
      const undoStored = localStorage.getItem(UNDO_KEY);
      if (undoStored) {
        this.lastDeletedItem = JSON.parse(undoStored);
      }
    } catch (e) {
      console.error('Failed to load shopping list:', e);
      this.items = [];
      this.lastDeletedItem = null;
    }
  }

  saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch (e) {
      console.error('Failed to save shopping list:', e);
    }
  }

  save(deletedItemIds = []) {
    this.saveLocal();
    this.syncToFirestore(deletedItemIds);
  }

  saveUndo() {
    try {
      if (this.lastDeletedItem) {
        localStorage.setItem(UNDO_KEY, JSON.stringify(this.lastDeletedItem));
      } else {
        localStorage.removeItem(UNDO_KEY);
      }
    } catch (e) {
      console.error('Failed to save undo state:', e);
    }
  }

  async syncToFirestore(deletedItemIds = []) {
    if (this.syncManager && this.syncManager.isEnabled()) {
      try {
        await this.syncManager.syncItems(this.items, deletedItemIds);
      } catch (e) {
        console.warn('Firestore sync failed:', e);
      }
    }
  }

  // Generate a client-side timestamp for local mutations
  // This is used for LWW conflict resolution before server timestamps resolve
  _now() {
    return Date.now();
  }

  // Ensure item has a client-side updatedAt timestamp
  _ensureUpdatedAt(item) {
    if (!item.updatedAt) {
      item.updatedAt = this._now();
    }
    return item;
  }

  add(item) {
    const existing = this.items.find(i => 
      i.name.toLowerCase() === item.name.toLowerCase() && 
      i.unit === item.unit
    );
    
    if (existing) {
      existing.quantity += item.quantity;
      existing.updatedAt = this._now();
    } else {
      this._ensureUpdatedAt(item);
      this.items.push(item);
    }
    
    this.save();
  }

  remove(id) {
    const index = this.items.findIndex(i => i.id === id);
    if (index !== -1) {
      // Store the deleted item for undo with a fresh timestamp
      const deletedItem = { ...this.items[index], deletedAt: this._now() };
      this.lastDeletedItem = deletedItem;
      // Remove from local array (UI disappears immediately)
      this.items = this.items.filter(i => i.id !== id);
      this.save([id]);
      this.saveUndo();
    }
  }

  // Soft delete: creates a deletion mutation for Firestore without
  // affecting the local items array (which is already filtered by remove())
  // This is called by syncItems when syncing to Firestore
  getDeletionMutations() {
    // This method is not directly used; syncItems handles deletion via
    // the items array passed to it. For deleted items, we need to track them.
    // The SyncManager will handle deletion by receiving items with deleted: true
    return [];
  }

  undo() {
    if (!this.lastDeletedItem) {
      return false;
    }
    
    // Check if an item with the same name+unit already exists (e.g., re-added)
    const existing = this.items.find(i => 
      i.name.toLowerCase() === this.lastDeletedItem.name.toLowerCase() && 
      i.unit === this.lastDeletedItem.unit
    );
    
    if (existing) {
      existing.quantity += this.lastDeletedItem.quantity;
      existing.updatedAt = this._now();
    } else {
      // Restore the item (without deletedAt) with a fresh timestamp
      const { deletedAt, ...itemToRestore } = this.lastDeletedItem;
      itemToRestore.updatedAt = this._now();
      this.items.push(itemToRestore);
    }
    
    this.save();
    this.lastDeletedItem = null;
    this.saveUndo();
    return true;
  }

  canUndo() {
    return this.lastDeletedItem !== null;
  }

  update(item) {
    const index = this.items.findIndex(i => i.id === item.id);
    if (index !== -1) {
      // Always update the timestamp when the item is modified
      // unless the caller explicitly passes preserveTimestamp: true
      if (!item.preserveTimestamp) {
        item.updatedAt = this._now();
      }
      this.items[index] = item;
      this.save();
    }
  }

  findByName(name) {
    const query = name.toLowerCase();

    // Prefer an exact match ("milk" -> "Milk") over a fuzzy one so that
    // removing/updating "milk" can't accidentally hit "Almond Milk" just
    // because it happens to sit earlier in the list. Only fall back to
    // substring matching when nothing matches exactly, and among those
    // fuzzy matches prefer the shortest name (the closest match to what
    // was actually said).
    const exact = this.items.find(i => i.name.toLowerCase() === query);
    if (exact) return exact;

    const fuzzyMatches = this.items.filter(i =>
      i.name.toLowerCase().includes(query) || query.includes(i.name.toLowerCase())
    );

    if (fuzzyMatches.length === 0) return undefined;

    return fuzzyMatches.reduce((closest, candidate) =>
      candidate.name.length < closest.name.length ? candidate : closest
    );
  }

  clear() {
    // Capture all current item IDs for proper deletion sync
    const itemIdsToDelete = this.items.map(item => item.id);
    this.items = [];
    this.save(itemIdsToDelete);
    // Return the IDs so callers can report or test the deletion scope
    return itemIdsToDelete;
  }

  clearCompleted() {
    const completedIds = this.items.filter(item => item.completed).map(item => item.id);
    if (completedIds.length === 0) return [];

    const ids = new Set(completedIds);
    this.items = this.items.filter(item => !ids.has(item.id));
    this.save(completedIds);
    return completedIds;
  }

  toggleCompleted(id) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.completed = !item.completed;
      item.updatedAt = this._now();
      this.save();
      return item;
    }
    return null;
  }

  incrementQuantity(id, delta = 1) {
    const item = this.items.find(i => i.id === id);
    if (!item) return null;

    const newQty = (item.quantity || 1) + delta;
    if (newQty <= 0) {
      this.remove(id);
      return null;
    }

    item.quantity = Number((newQty).toFixed(2));
    item.updatedAt = this._now();
    this.save();
    return item;
  }

  getEstimatedTotal(productCatalog) {
    if (!productCatalog || !productCatalog.products) return 0;
    let total = 0;
    for (const item of this.items) {
      const product = item.productId 
        ? productCatalog.getById(item.productId) 
        : productCatalog.findBestMatch(item.name);
      if (product && typeof product.price === 'number') {
        total += product.price * (item.quantity || 1);
      }
    }
    return Number(total.toFixed(2));
  }

  exportAsCSV() {
    if (this.items.length === 0) return '';
    const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [['Name', 'Category', 'Quantity', 'Unit', 'Completed', 'Product ID'].join(',')];
    for (const item of this.getAll()) {
      rows.push([
        escape(item.name),
        escape(item.category),
        item.quantity ?? '',
        escape(item.unit),
        item.completed ? 'yes' : 'no',
        item.productId ?? ''
      ].join(','));
    }
    return rows.join('\n');
  }

  exportAsText() {
    if (this.items.length === 0) return 'Shopping list is empty.';
    const dateStr = new Date().toLocaleDateString();
    let text = `Shopping List (${dateStr})\n`;
    text += `Total items: ${this.items.length}\n\n`;

    const grouped = this.groupedByCategory;
    for (const [category, items] of Object.entries(grouped)) {
      text += `[${category.toUpperCase()}]\n`;
      for (const item of items) {
        const mark = item.completed ? '[x] ' : '- ';
        const unit = item.unit ? ` ${item.unit}` : '';
        text += `${mark}${item.name} - ${item.quantity}${unit}\n`;
      }
      text += '\n';
    }
    return text.trim();
  }

  exportAsMarkdown() {
    if (this.items.length === 0) return '_Shopping list is empty._';
    const dateStr = new Date().toLocaleDateString();
    let md = `### Shopping List - ${dateStr}\n\n`;

    const grouped = this.groupedByCategory;
    for (const [category, items] of Object.entries(grouped)) {
      md += `#### ${category}\n`;
      for (const item of items) {
        const check = item.completed ? '[x]' : '[ ]';
        const unit = item.unit ? ` ${item.unit}` : '';
        md += `- ${check} **${item.name}** (${item.quantity}${unit})\n`;
      }
      md += '\n';
    }
    return md.trim();
  }

  getAll() {
    return this.items.filter(item => !item.deleted).sort((a, b) => {
      // Uncompleted items first, then by category, then by name
      if (Boolean(a.completed) !== Boolean(b.completed)) {
        return a.completed ? 1 : -1;
      }
      return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
    });
  }

  get groupedByCategory() {
    const grouped = {};
    for (const item of this.getAll()) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }
    return grouped;
  }

  get totalItems() {
    return this.items.length;
  }

  get completedCount() {
    return this.items.filter(i => i.completed).length;
  }
}