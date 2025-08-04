import {Prisma} from "@prisma/client";

export interface CreateProductInput {
    name: string;
    description?: string;
    published?: boolean;
    stock_managed?: boolean;
    product_type_id?: number;
    product_category_id?: number;
    price_currency?: string;
    price_amount?: number;
    product_colours?: ProductColourInput[]
    market_id?: number;
}

export interface ProductColourInput {
    colour: string;
    image_url: string;
    stock: SizeStock[];
}

export interface SizeStock {
    size: string;
    stock: number;
}

export interface UpdateProductInput extends CreateProductInput {
    id: number;
}

export interface ProductFilters {
    name?: string;
    deleted?: boolean;
    published?: boolean;
    product_type?: number;
    product_category?: number;
    take?: number;
    skip?: number;
}

export interface ProductColourStockInput {
    id: number;
    product_id: number;
    colour: string;
    image_url: string;
    stock: SizeStock[];
}


const productWithTypeCategory = Prisma.validator<Prisma.productsDefaultArgs>()({
    include: {product_category: true, product_type: true, product_colours: true, market: true}
})

export type ProductExtended = Prisma.productsGetPayload<typeof productWithTypeCategory>