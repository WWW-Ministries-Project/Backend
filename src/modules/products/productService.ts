import {prisma} from "../../Models/context";
import {
    CreateProductInput,
    CreateStockData,
    ProductExtended,
    ProductFilters, ProductImage,
    SizeStock,
    UpdateProductInput
} from "./productInterface";
import {product_image, product_stock} from "@prisma/client";

export class ProductService {
    private readonly _include = {
        product_category: true,
        product_type: true,
        sizes: true,
        product_image: true,
        product_stock: true
    };

    constructProductData(input: CreateProductInput) {
        return {
            data: {
                name: input.name.trim(),
                description: input.description?.trim(),
                published: input.published,
                product_type: this.connectProductType(input),
                product_category: this.connectProductCategory(input),
                price_currency: input.price_currency,
                price_amount: input.price_amount,
                market: {
                    connect: {
                        id: input.market_id
                    }
                }
            },
            include: {
                product_category: true,
                product_type: true,
                product_stock: true,
                market: true
            }
        }
    }

    async createProduct(input: CreateProductInput) {
        if (!(await this.marketCheck(input.market_id))) {
            throw new Error("Market with given id does not exist");
        }
        const product = await prisma.products.create({...(this.constructProductData(input))});
        await this.createProductStock({
            product_id: product.id,
            size_stock: input.product_stock
        });
        const count = await this.createProductImage(product.id, input.product_image);
        console.log(count);
        const stock = await prisma.product_stock.findMany({
            where: {
                product_id: product.id
            }
        });
        const images = await prisma.product_image.findMany({
            where: {
                product_id: product.id
            }
        })

        return this.transformToProductDto(product, stock, images);
    }

    async updateProduct(input: UpdateProductInput) {
        if (!(await prisma.products.findFirst({where: {id: input.product_id}}))) {
            throw new Error("Product with given id not found");
        }
        const product = await prisma.products.update({
            where: {id: input.product_id},
            ...(this.constructProductData(input))
        });

        const stock = await prisma.product_stock.findMany({
            where: {
                product_id: product.id
            }
        });
        const images = await prisma.product_image.findMany({
            where: {
                product_id: product.id
            }
        })
        return this.transformToProductDto(product, stock, images);
    }

    transformToProductDto(product: ProductExtended, stock: product_stock[], productImage: product_image[]) {
        return {
            id: product.id,
            name: product.name,
            description: product.description,
            product_category: product.product_category,
            product_type: product.product_type,
            price_currency: product.price_currency,
            price_amount: product.price_amount,
            market: product.market,
            market_id: product.market_id,
            published: product.published,
            product_stock: stock,
            product_image: productImage
        }
    }

    async createProductImage(product_id: number, productImages: ProductImage[]) {
        const data = productImages.map(s => ({
            product_id,
            colour: s.colour,
            image_url: s.image_url

        }));
        return prisma.product_image.createMany({data})
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

    async getProductsByMarketId(marketId: number) {
        return prisma.products.findFirst({
            where: {
                market_id: marketId,
                deleted: false
            },
            include: {
                product_category: true,
                product_type: true
            }
        })
    }

    async listProducts(filters?: ProductFilters) {
        const where = {
            name: filters?.name ? {
                contains: filters.name
            } : undefined,
            deleted: filters?.deleted || undefined,
            published: filters?.published || undefined,
            product_type_id: filters?.product_type ?? undefined,
            product_category_id: filters?.product_category ?? undefined
        }
        return prisma.products.findMany({
            where,
            take: filters?.take,
            skip: filters?.skip
        })
    }

    private async updateDeletedOnProduct(product_id: number, deleted: boolean) {
        return prisma.products.update({
            where: {
                id: product_id
            },
            data: {
                deleted
            }
        });
    }

    private generateProductData(input: CreateProductInput) {
        return {
            name: input.name.trim(),
            description: input.description?.trim(),
            published: input.published,
            product_type: this.connectProductType(input),
            product_category: this.connectProductCategory(input),
            price_currency: input.price_currency,
            price_amount: input.price_amount
        };
    }

    private async createProductStock(input: CreateStockData) {
        const data = input.size_stock.map(i => ({
            product_id: input.product_id,
            size_id: i.size_id,
            stock: i.stock
        }));
        return prisma.product_stock.createMany({data})
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

    async marketCheck(id?: number) {
        return prisma.markets.findFirst({where: {id}})
    }

    async createProductType(name: string) {
        const check = await this.getProductTypeByExistingName(name);
        if (check) {
            if (!check.deleted) {
                throw new Error("Product type exists with given name");
            }
            return prisma.product_type.update({
                where: {
                    id: check.id
                },
                data: {
                    deleted: false,
                    name
                }
            })
        }
        return prisma.product_type.create({
            data: {
                name: name.trim()
            }
        })
    }

    async updateProductType(id: number, name: string) {
        const check = await this.getProductTypeByExistingName(name);
        if (check) {
            if (!check.deleted) {
                throw new Error("Product type exists with given name");
            }
            await prisma.product_type.update({
                where: {
                    id: check.id
                },
                data: {
                    name: ""
                }
            })
        }
        return prisma.product_type.update({where: {id}, data: {name}})
    }

    async deleteProductType(id: number) {
        return prisma.product_type.update({where: {id}, data: {deleted: true}});
    }

    async restoreProductType(id: number) {
        return prisma.product_type.update({where: {id}, data: {deleted: false}});
    }

    async listProductTypes() {
        return prisma.product_type.findMany(({
            where: {deleted: false}
        }))
    }

    async createProductCategory(name: string) {
        const check = await this.getProductCategoryByExistingName(name);
        if (check) {
            if (!check.deleted) {
                throw new Error("Product category exists with given name");
            }
            return prisma.product_category.update({
                where: {
                    id: check.id
                },
                data: {
                    deleted: false,
                    name
                }
            })
        }
        return prisma.product_category.create({
            data: {
                name: name.trim()
            }
        })
    }

    async updateProductCategory(id: number, name: string) {
        const check = await this.getProductCategoryByExistingName(name);
        if (check) {
            if (!check.deleted) {
                throw new Error("Product category exists with given name");
            }
            await prisma.product_category.update({
                where: {
                    id: check.id
                },
                data: {
                    name: ""
                }
            })
        }
        return prisma.product_category.update({where: {id}, data: {name}})
    }

    async deleteProductCategory(id: number) {
        return prisma.product_category.update({where: {id}, data: {deleted: true}});
    }

    async restoreProductCategory(id: number) {
        return prisma.product_category.update({where: {id}, data: {deleted: false}});
    }

    async listProductCategories() {
        return prisma.product_category.findMany(({
            where: {deleted: false}
        }))
    }

    async getProductTypeByExistingName(name: string) {
        return prisma.product_type.findFirst({
            where: {
                name
            }
        });
    }

    async getProductCategoryByExistingName(name: string) {
        return prisma.product_category.findFirst({
            where: {
                name
            }
        });
    }
}