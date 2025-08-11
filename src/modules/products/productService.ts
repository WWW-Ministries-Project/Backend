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
        market: true,
        product_colours: {
            include: {
                    sizes: {
                        include: {
                            size: {
                                select: { name: true }
                            }
                        },
                    },
                },
            },
        }
    // private readonly _where = (filters: ProductFilters) => ({
    //     name: filters?.name ? {
    //         contains: filters.name
    //     } : undefined,
    //     deleted: filters?.deleted ?? false,
    //     published: filters?.published ?? undefined,
    //     product_type_id: filters?.product_type ?? undefined,
    //     product_category_id: filters?.product_category ?? undefined
    // })

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
                price_amount: Number(input.price_amount),
                market: {
                    connect: {
                        id: Number(input.market_id)
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
        if (!(await this.marketCheck(Number(input.market_id)))) {
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

            // Get size IDs for all the size names in the stock array
            const sizeNames = stock.map(s => s.size);
            const sizes = await prisma.sizes.findMany({
                where: {
                    name: {
                        in: sizeNames
                    }
                },
                select: {
                    id: true,
                    name: true
                }
            });

            // Create a map for quick lookup
            const sizeNameToIdMap = new Map(sizes.map(size => [size.name, size.id]));

            await prisma.product_stock.createMany({
                data: stock.map(s => ({
                    product_colour_id: productColour.id,
                    size_id: sizeNameToIdMap.get(s.size)!, // Using the size name to get the ID
                    stock: s.stock
                }))
            });

            results.push(await prisma.product_colour.findMany({where: {product_id}}))
        }
        return results;
    }


    async createProductColours(product_id: number, colourInputs: ProductColourInput[]) {
        // Get all unique size names across all colour inputs
        const allSizeNames = [...new Set(colourInputs.flatMap(input => input.stock.map(s => s.size)))];

        // Fetch all sizes once
        const sizes = await prisma.sizes.findMany({
            where: {
                name: {
                    in: allSizeNames
                }
            },
            select: {
                id: true,
                name: true
            }
        });

        // Create a map for quick lookup
        const sizeNameToIdMap = new Map(sizes.map(size => [size.name, size.id]));

        const colourStocks = [];
        for (let input of colourInputs) {
            const {colour, image_url} = input;

            const colourStock = await prisma.product_colour.create({
                data: {
                    colour,
                    image_url,
                    product: {connect: {id: product_id}},
                    sizes: {
                        createMany: {
                            data: input.stock.map(s => ({
                                size_id: sizeNameToIdMap.get(s.size)!,
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
        const product = await prisma.products.findFirst({
        where: { id, deleted: false },
        include: this._include
        })

    if (!product) {
        return null;
    }

    const transformed = {
        ...product,
        product_colours: product.product_colours.map((colour: any) => ({
            colour: colour.colour,
            image_url: colour.image_url,
            stock: colour.sizes.map((s: any) => ({
                size: s.size.name,
                stock: s.stock
            }))
        }))
    };
    return transformed;
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
            deleted: filters?.deleted || false,
            published: filters?.published ?? undefined,
            product_type_id: filters?.product_type ?? undefined,
            product_category_id: filters?.product_category ?? undefined
        }
        const all_products = await prisma.products.findMany({
        where,
        include: {
            product_colours: {
                include: {
                    sizes: {
                        include: {
                            size: {
                                select: { name: true }
                            }
                        }
                    }
                }
            },
            product_category: true,
            product_type: true,
        },
        take: filters?.take,
        skip: filters?.skip
    });

    // Transform for frontend
    const transformed = all_products.filter(
        (product) => product.product_category?.deleted!=true ).map(
            product => ({
        ...product,
        product_colours: product.product_colours.map(colour => ({
            colour: colour.colour,
            image_url: colour.image_url,
            stock: colour.sizes.map(s => ({
                size: s.size.name,
                stock: s.stock
            }))
        }))
    }));

    
        return transformed
    }

    async listProductsByMarketId(market_id: number, filters?: ProductFilters) {
        //to fix the filters later
        const all_products = await prisma.products.findMany({
            where: {deleted:false, market_id},
            include:{
                product_colours: {
                include: {
                    sizes: {
                        include: {
                            size: {
                                select: { name: true }
                            }
                        }
                    }
                }
            },
                product_category : true,
                product_type : true,
            },
            take: filters?.take,
            skip: filters?.skip
        })
        
    const transformed = all_products.filter(
        (product) => product.product_category?.deleted!=true ).map(
            product => ({
        ...product,
        product_colours: product.product_colours.map(colour => ({
            colour: colour.colour,
            image_url: colour.image_url,
            stock: colour.sizes.map(s => ({
                size: s.size.name,
                stock: s.stock
            }))
        }))
    }));

    
        return transformed
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
        return input.product_type_id ? {connect: {id: Number(input.product_type_id)}} : undefined;
    }

    private connectProductCategory(input: CreateProductInput | UpdateProductInput) {
        return input.product_category_id ? {connect: {id: Number(input.product_category_id)}} : undefined;
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