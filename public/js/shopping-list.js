const STORAGE_KEY = 'voice_shopping_list';

export class ShoppingList {
  constructor() {
    this.items = [];
  }

  load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.items = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load shopping list:', e);
      this.items = [];
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch (e) {
      console.error('Failed to save shopping list:', e);
    }
  }

  add(item) {
    const existing = this.items.find(i => 
      i.name.toLowerCase() === item.name.toLowerCase() && 
      i.unit === item.unit
    );
    
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      this.items.push(item);
    }
    
    this.save();
  }

  remove(id) {
    this.items = this.items.filter(i => i.id !== id);
    this.save();
  }

  update(item) {
    const index = this.items.findIndex(i => i.id === item.id);
    if (index !== -1) {
      this.items[index] = item;
      this.save();
    }
  }

  findByName(name) {
    return this.items.find(i => 
      i.name.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(i.name.toLowerCase())
    );
  }

  clear() {
    this.items = [];
    this.save();
  }

  getAll() {
    return [...this.items].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
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
}