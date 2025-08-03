import {prisma} from "../../Models/context";
import {
    CreateProductInput,
    ProductColourInput,
    ProductColourStockInput,
    ProductFilters,
    UpdateProductInput
} from "./productInterface";

export class ProductService {
    private readonly _include = {
        product_category: true,
        product_type: true,
        sizes: {
            include: {
                size: true
            }
        },
        product_image: true,
        product_stock: true
    };
    private readonly _where = (filters: ProductFilters) => ({
        name: filters?.name ? {
            contains: filters.name
        } : undefined,
        deleted: filters?.deleted ?? undefined,
        published: filters?.published ?? undefined,
        product_type_id: filters?.product_type ?? undefined,
        product_category_id: filters?.product_category ?? undefined
    })

    constructProductData(input: CreateProductInput) {
        return {
            data: {
                name: input.name.trim(),
                description: input.description?.trim(),
                published: input.published,
                stock_managed: input.stock_managed,
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
                market: true
            }
        }
    }

    async createProduct(input: CreateProductInput) {
        if (!(await this.marketCheck(input.market_id))) {
            throw new Error("Market with given id does not exist");
        }
        const product = await prisma.products.create({...(this.constructProductData(input))});
        let product_colours;
        if (input.product_colours?.length) {
            product_colours = await this.createProductColours(product.id, input.product_colours);
        }
        return {product, product_colours}
    }

    async updateProduct(input: UpdateProductInput) {
        if (!(await prisma.products.findFirst({where: {id: input.id}}))) {
            throw new Error("Product with given id not found");
        }
        const product = await prisma.products.update({
            where: {id: input.id},
            ...(this.constructProductData(input))
        });
        const product_colours = await prisma.product_colour.findMany({
            where: {product_id: product.id},
            include: {sizes: {include: {size: true}}}
        });
        return {product, product_colours}
    }

    async updateProductColours(input: ProductColourStockInput[]) {
        const results = [];
        for (let item of input) {
            const {id, colour, image_url, stock, product_id} = item;
            const productColour = await prisma.product_colour.update({
                where: {id},
                data: {colour, image_url}
            });
            await prisma.product_stock.deleteMany({
                where: {
                    product_colour_id: productColour.id
                }
            });
            await prisma.product_stock.createMany({
                data: stock.map(s => ({
                    product_colour_id: productColour.id,
                    size_id: s.size_id,
                    stock: s.stock
                }))
            })
            results.push(await prisma.product_colour.findMany({where: {product_id}}))
        }
        return results;
    }


    async createProductColours(product_id: number, colourInputs: ProductColourInput[]) {
        const colourStocks = [];
        for (let input of colourInputs) {
            const {colour, image_url} = input;
            const colourStock = await prisma.product_colour.create({
                data: {
                    colour, image_url,
                    product: {connect: {id: product_id}},
                    sizes: {
                        createMany: {
                            data: input.stock.map(s => ({
                                size_id: s.size_id,
                                stock: s.stock
                            }))
                        }
                    }
                }
            });
            colourStocks.push(colourStock);
        }
        return colourStocks;
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
            include: this._include
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

    async listProductsByMarketId(market_id: number, filters?: ProductFilters) {
        return prisma.products.findMany({
            where: {...this._where, market_id},
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

    private connectProductType(input: CreateProductInput | UpdateProductInput) {
        return input.product_type_id ? {connect: {id: input.product_type_id}} : undefined;
    }

    private connectProductCategory(input: CreateProductInput | UpdateProductInput) {
        return input.product_category_id ? {connect: {id: input.product_category_id}} : undefined;
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