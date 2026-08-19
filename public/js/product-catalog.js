export class ProductCatalog {
  constructor() {
    this.products = [];
  }

  async load() {
    try {
      const response = await fetch('/data/products.json');
      if (!response.ok) throw new Error('Failed to load products');
      this.products = await response.json();
    } catch (e) {
      console.error('Product catalog load error:', e);
      this.products = [];
    }
  }

  findBestMatch(query) {
    const lowerQuery = query.toLowerCase();
    
    let bestMatch = null;
    let bestScore = 0;

    for (const product of this.products) {
      let score = 0;
      
      if (product.name.toLowerCase() === lowerQuery) {
        return product;
      }
      
      if (product.name.toLowerCase().includes(lowerQuery)) {
        score += 10;
      }
      
      for (const keyword of product.keywords) {
        if (lowerQuery.includes(keyword.toLowerCase())) {
          score += 5;
        }
        if (keyword.toLowerCase().includes(lowerQuery)) {
          score += 3;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = product;
      }
    }

    return bestMatch;
  }

  search(filters = {}) {
    let results = [...this.products];

    if (filters.query) {
      const query = filters.query.toLowerCase();
      results = results.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.keywords.some(k => k.toLowerCase().includes(query))
      );
    }

    if (filters.brand) {
      const brand = filters.brand.toLowerCase();
      results = results.filter(p => p.brand.toLowerCase().includes(brand));
    }

    if (filters.category) {
      const category = filters.category.toLowerCase();
      results = results.filter(p => p.category.toLowerCase() === category);
    }

    if (filters.maxPrice !== null && filters.maxPrice !== undefined) {
      results = results.filter(p => p.price <= filters.maxPrice);
    }

    if (filters.isOrganic) {
      results = results.filter(p => p.keywords.some(k => k.toLowerCase().includes('organic')));
    }

    return results.sort((a, b) => a.price - b.price);
  }

  getSubstitutes(productName) {
    const product = this.products.find(p => 
      p.name.toLowerCase() === productName.toLowerCase()
    );
    if (!product) return [];

    return this.products.filter(p => 
      product.substitutes.includes(p.name)
    );
  }

  getSeasonal(month = new Date().getMonth() + 1) {
    const seasonalMap = {
      1: ['Oranges', 'Apples', 'Carrots'],
      2: ['Oranges', 'Strawberries', 'Spinach'],
      3: ['Strawberries', 'Asparagus', 'Peas'],
      4: ['Strawberries', 'Asparagus', 'Mangoes'],
      5: ['Mangoes', 'Watermelon', 'Tomatoes'],
      6: ['Mangoes', 'Watermelon', 'Corn'],
      7: ['Watermelon', 'Corn', 'Tomatoes'],
      8: ['Corn', 'Tomatoes', 'Peaches'],
      9: ['Apples', 'Pears', 'Grapes'],
      10: ['Apples', 'Pears', 'Pomegranates'],
      11: ['Oranges', 'Apples', 'Cranberries'],
      12: ['Oranges', 'Apples', 'Carrots']
    };

    const seasonalNames = seasonalMap[month] || [];
    return this.products.filter(p => seasonalNames.includes(p.name));
  }

  getAll() {
    return [...this.products];
  }

  getById(id) {
    return this.products.find(p => p.id === id);
  }
}