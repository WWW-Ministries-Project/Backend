import {markets, Prisma, product_category, product_type} from "@prisma/client";

export interface CreateProductInput {
    name: string;
    description?: string;
    published?: boolean;
    product_type_id?: number;
    product_category_id?: number;
    product_image: ProductImage[];
    price_currency?: string;
    price_amount?: number;
    product_stock: SizeStock[]
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
    size_stock: SizeStock[]
}

export interface SizeStock {
    size_id: number;
    stock: number;
}

export interface ProductDto {
    id: number;
    name?: string;
    description?: string | null;
    published: boolean;
    product_category: product_category | null;
    product_type: product_type | null;
    price_currency: string | null;
    price_amount: number | null;
    market: markets | null;
    market_id: number | null;
    product_stock: SizeStock[];
    product_image: ProductImage[];
}

export interface ProductTypeCategoryDto {
    id: number;
    name: string;
    deleted: false;
}

const productWithTypeCategory = Prisma.validator<Prisma.productsDefaultArgs>()({
    include: {product_category: true, product_type: true, product_stock: true, market: true}
})

export type ProductExtended = Prisma.productsGetPayload<typeof productWithTypeCategory>