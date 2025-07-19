import {prisma} from "../../Models/context";
import {CreateProductInput, ProductFilters, UpdateProductInput} from "./productInterface";

export class ProductService {
    private readonly _include = {
        product_category: true,
        product_type: true,
        products_sizes: true,
        sizes: true
    };

    async createProduct(input: CreateProductInput) {
        return await prisma.products.create({
            data: this.generateProductData(input),
            include: this._include
        })
    }

    async updateProduct(data: UpdateProductInput) {
        if (!(await prisma.products.findFirst({where: {id: data.product_id}}))) {
            throw new Error("Product with given id not found");
        }
        return await prisma.products.update({
            where: {
                id: data.product_id
            },
            data: this.generateProductData(data),
            include: this._include
        })
    }

    async softDeleteProduct(product_id: number) {
        return this.updateDeletedOnProduct(product_id, true);
    }

    async restoreProduct(product_id: number) {
        return this.updateDeletedOnProduct(product_id, false);
    }

    async getProductById(id: number) {
        return prisma.products.findFirst({
            where: {id, deleted: false},
            include: {
                product_category: true,
                product_type: true
            }
        })
    }

    async listProducts(filters: ProductFilters) {
        const where = {
            name: filters.name ? {
                contains: filters.name
            } : undefined,
            deleted: filters.deleted || undefined,
            published: filters.published || undefined,
            product_type_id: filters.product_type || undefined,
            product_category_id: filters.product_category || undefined,
        }
    }

    private async updateDeletedOnProduct(product_id: number, deleted: boolean) {
        return await prisma.products.update({
            where: {
                id: product_id
            },
            data: {
                deleted
            }
        })
    }

    private generateProductData(input: CreateProductInput) {
        return {
            name: input.name.trim(),
            description: input.description?.trim(),
            image: input.image?.trim(),
            published: input.published,
            product_type: this.connectProductType(input),
            product_category: this.connectProductCategory(input),
            colours: input.colours?.join(','),
            price_currency: input.price_currency,
            price_amount: input.price_amount,
            sizes: this.connectSizes(input.size_ids),
            stock: input.stock
        };
    }

    private connectProductType(input: CreateProductInput | UpdateProductInput) {
        return input.product_type_id ? {connect: {id: input.product_type_id}} : undefined;
    }

    private connectSizes(sizeIds?: number[]) {
        return (sizeIds && sizeIds.length) ? {
            connect: sizeIds.map(id => ({id}))
        } : undefined;
    }

    private connectProductCategory(input: CreateProductInput | UpdateProductInput) {
        return input.product_category_id ? {connect: {id: input.product_category_id}} : undefined;
    }

    private aggregateColours(input: string[]) {
        return input.join(',');
    }

    async createSize(name: string, sort_order: number) {
        return prisma.sizes.create({
            data: {
                name,
                sort_order
            }
        });
    }

    async updateSize(id: number, name: string, sort_order: number) {
        return prisma.sizes.update({
            where: {id},
            data: {
                name,
                sort_order
            }
        });
    }

    async listSizes() {
        return prisma.sizes.findMany();
    }
}