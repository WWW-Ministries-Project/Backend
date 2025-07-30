import {prisma} from "../../Models/context";
import {CreateProductInput, CreateStockData, ProductFilters, UpdateProductInput} from "./productInterface";

export class ProductService {
    private readonly _include = {
        product_category: true,
        product_type: true,
        products_sizes: true,
        sizes: true
    };

    async createProduct(input: CreateProductInput) {
        // if (!(await this.marketCheck(input.market_id))) {
        //     throw new Error("Market with given id does not exist");
        // }
        // const {} =
        // const product = await prisma.products.create({
        //     data: {
        //         name: input.name.trim(),
        //         description: input.description?.trim(),
        //         image: input.image?.trim(),
        //         published: input.published,
        //         product_type: this.connectProductType(input),
        //         product_category: this.connectProductCategory(input),
        //         price_currency: input.price_currency,
        //         price_amount: input.price_amount
        //     },
        //     include: this._include
        // });
        // const stock = await this.createProductStock({
        //
        // })
    }

    async updateProduct(data: UpdateProductInput) {
        if (!(await prisma.products.findFirst({where: {id: data.product_id}}))) {
            throw new Error("Product with given id not found");
        }
        return prisma.products.update({
            where: {
                id: data.product_id
            },
            data: this.generateProductData(data),
            include: this._include
        });
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
            image: input.image?.trim(),
            published: input.published,
            product_type: this.connectProductType(input),
            product_category: this.connectProductCategory(input),
            price_currency: input.price_currency,
            price_amount: input.price_amount
        };
    }

    private async createProductStock(input: CreateStockData) {
        const data = input.size_ids.map(i => ({
            product_id: input.product_id,
            size_id: i,
            colour: input.colour,
            stock: input.stock
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