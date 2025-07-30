export interface CreateProductInput {
    name: string;
    description?: string;
    image?: string;
    published?: boolean;
    product_type_id?: number;
    product_category_id?: number;
    product_image: ProductImage[];
    price_currency?: string;
    price_amount?: number;
    product_stock: CreateProductStockInput
    market_id?: number;
}

export interface CreateProductStockInput {
    size_id: number;
    stock: number;
}

export interface ProductImage {
    colour: string;
    image_url: string;
}

export interface UpdateProductInput extends CreateProductInput {
    product_id: number;
}

export interface ProductFilters {
    name?: string;
    deleted?: boolean;
    published?: boolean;
    product_type?: number;
    product_category?: number;
    colours?: string[];
    size_ids?: string[];
    take?: number;
    skip?: number;
}

export interface CreateStockData {
    product_id: number;
    size_ids: number[];
    colour?: string;
    stock?: number;
}