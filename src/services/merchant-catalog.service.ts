import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-catalog');

const CAT_PREFIX = 'mcat:';
const CAT_TTL = 365 * 24 * 60 * 60;
const MAX_PRODUCTS = 100;

export interface Product {
  id: string;
  merchantId: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  sku: string | null;
  active: boolean;
  stock: number | null; // null = unlimited
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export class MerchantCatalogService {
  async addProduct(input: {
    merchantId: string;
    name: string;
    price: number;
    description?: string;
    category?: string;
    sku?: string;
    stock?: number;
    imageUrl?: string;
  }): Promise<Product> {
    if (!input.name || input.name.length > 100) throw new Error('Nombre entre 1 y 100 caracteres.');
    if (input.price < 1) throw new Error('Precio debe ser mayor a $0.');

    const products = await this.getProducts(input.merchantId);
    if (products.length >= MAX_PRODUCTS) throw new Error(`Maximo ${MAX_PRODUCTS} productos.`);

    if (input.sku) {
      const exists = products.some(p => p.sku === input.sku);
      if (exists) throw new Error('SKU duplicado.');
    }

    const product: Product = {
      id: `prod_${Date.now().toString(36)}`,
      merchantId: input.merchantId,
      name: input.name,
      description: input.description ?? null,
      price: input.price,
      category: input.category ?? null,
      sku: input.sku ?? null,
      active: true,
      stock: input.stock ?? null,
      imageUrl: input.imageUrl ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    products.push(product);
    await this.save(input.merchantId, products);

    log.info('Product added', { merchantId: input.merchantId, productId: product.id });
    return product;
  }

  async getProducts(merchantId: string): Promise<Product[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${CAT_PREFIX}${merchantId}`);
      return raw ? JSON.parse(raw) as Product[] : [];
    } catch {
      return [];
    }
  }

  async getActiveProducts(merchantId: string): Promise<Product[]> {
    const products = await this.getProducts(merchantId);
    return products.filter(p => p.active && (p.stock === null || p.stock > 0));
  }

  async getProduct(merchantId: string, productId: string): Promise<Product | null> {
    const products = await this.getProducts(merchantId);
    return products.find(p => p.id === productId) ?? null;
  }

  async updateProduct(merchantId: string, productId: string, updates: Partial<Pick<Product, 'name' | 'price' | 'description' | 'category' | 'active' | 'stock' | 'imageUrl'>>): Promise<Product | null> {
    const products = await this.getProducts(merchantId);
    const product = products.find(p => p.id === productId);
    if (!product) return null;

    if (updates.name !== undefined) product.name = updates.name;
    if (updates.price !== undefined) product.price = updates.price;
    if (updates.description !== undefined) product.description = updates.description;
    if (updates.category !== undefined) product.category = updates.category;
    if (updates.active !== undefined) product.active = updates.active;
    if (updates.stock !== undefined) product.stock = updates.stock;
    if (updates.imageUrl !== undefined) product.imageUrl = updates.imageUrl;
    product.updatedAt = new Date().toISOString();

    await this.save(merchantId, products);
    return product;
  }

  async deleteProduct(merchantId: string, productId: string): Promise<boolean> {
    const products = await this.getProducts(merchantId);
    const filtered = products.filter(p => p.id !== productId);
    if (filtered.length === products.length) return false;
    await this.save(merchantId, filtered);
    return true;
  }

  async decrementStock(merchantId: string, productId: string, qty = 1): Promise<boolean> {
    const products = await this.getProducts(merchantId);
    const product = products.find(p => p.id === productId);
    if (!product || product.stock === null) return false;
    if (product.stock < qty) return false;

    product.stock -= qty;
    await this.save(merchantId, products);
    return true;
  }

  async searchProducts(merchantId: string, query: string): Promise<Product[]> {
    const products = await this.getActiveProducts(merchantId);
    const lower = query.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(lower) ||
      (p.description?.toLowerCase().includes(lower)) ||
      (p.category?.toLowerCase().includes(lower)) ||
      (p.sku?.toLowerCase().includes(lower)),
    );
  }

  getProductLine(product: Product): string {
    const parts = [product.name, formatCLP(product.price)];
    if (product.stock !== null) parts.push(`Stock: ${product.stock}`);
    if (!product.active) parts.push('(inactivo)');
    return parts.join(' — ');
  }

  private async save(merchantId: string, products: Product[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${CAT_PREFIX}${merchantId}`, JSON.stringify(products), { EX: CAT_TTL });
    } catch (err) {
      log.warn('Failed to save catalog', { merchantId, error: (err as Error).message });
    }
  }
}

export const merchantCatalog = new MerchantCatalogService();
