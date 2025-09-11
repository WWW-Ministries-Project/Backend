import { prisma } from "../../Models/context";
import {
  CreateProductInput,
  ProductColourInput,
  ProductColourStockInput,
  ProductFilters,
  UpdateProductInput,
} from "./productInterface";

export class ProductService {
  private readonly _include = {
    product_category: true,
    product_type: true,
    market: true,
    product_colours: {
      select: {
        id: true,
        colour: true,
        image_url: true,
        sizes: {
          include: {
            size: {
              select: { name: true },
            },
          },
        },
      },
    },
  };

  // private readonly _where = (filters: ProductFilters) => ({
  //     name: filters?.name ? {
  //         contains: filters.name
  //     } : undefined,
  //     deleted: filters?.deleted ?? false,
  //     status: filters?.status ?? undefined,
  //     product_type_id: filters?.product_type ?? undefined,
  //     product_category_id: filters?.product_category ?? undefined
  // })

  constructProductData(input: CreateProductInput) {
    return {
      data: {
        name: input.name.trim(),
        description: input.description?.trim(),
        status: input.status,
        stock_managed: input.stock_managed,
        product_type: this.connectProductType(input),
        product_category: this.connectProductCategory(input),
        price_currency: input.price_currency,
        price_amount: Number(input.price_amount),
        market: {
          connect: {
            id: Number(input.market_id),
          },
        },
      },
      include: {
        product_category: true,
        product_type: true,
        market: true,
      },
    };
  }

  async createProduct(input: CreateProductInput) {
    if (!(await this.marketCheck(Number(input.market_id)))) {
      throw new Error("Market with given id does not exist");
    }
    const product = await prisma.products.create({
      ...this.constructProductData(input),
    });
    let product_colours;
    if (input.product_colours?.length) {
      product_colours = await this.createProductColours(
        product.id,
        input.product_colours,
      );
    }
    return { product, product_colours };
  }

  async updateProduct(input: {
    id: number;
    name: any;
    description: any;
    colours: any;
    image_url: any;
    deleted: any;
    stock_managed: any;
    status: any;
    product_type_id: any;
    product_category_id: any;
    price_currency: any;
    price_amount: any;
    market_id: any;
    product_colours: any[];
  }) {
    const existingProduct = await prisma.products.findUnique({
      where: { id: input.id },
    });

    if (!existingProduct) {
      throw new Error("Product with given id not found");
    }

    // Update product details
    await prisma.products.update({
      where: { id: input.id },
      data: {
        name: input.name,
        description: input.description,
        colours: input.colours,
        image_url: input.image_url,
        deleted: input.deleted,
        stock_managed: input.stock_managed,
        status: input.status,
        product_type_id: Number(input.product_type_id),
        product_category_id: input.product_category_id,
        price_currency: input.price_currency,
        price_amount: Number(input.price_amount),
        market_id: Number(input.market_id),
        updated_at: new Date(),
      },
    });

    // STEP 1 — delete product stocks first (since they depend on product_colour)
    await prisma.product_stock.deleteMany({
      where: {
        product_colour: { product_id: input.id },
      },
    });

    // STEP 2 — delete product colours
    await prisma.product_colour.deleteMany({
      where: { product_id: input.id },
    });

    // STEP 3 — Ensure all required sizes exist before creating colours + stock
    if (input.product_colours?.length) {
      // Get all unique size names across all colour inputs
      const allSizeNames = [
        ...new Set(
          input.product_colours.flatMap((colourItem: any) =>
            colourItem.stock.map((s: any) => s.size),
          ),
        ),
      ];

      // Fetch existing sizes
      const existingSizes = await prisma.sizes.findMany({
        where: {
          name: {
            in: allSizeNames,
          },
        },
      });

      // Find missing size names
      const existingSizeNames = new Set(existingSizes.map((size) => size.name));
      const missingSizeNames = allSizeNames.filter(
        (name) => !existingSizeNames.has(name),
      );

      // Create missing sizes
      let newSizes: {
        id: number;
        name: string;
        sort_order: number | null;
        created_at: Date;
        updated_at: Date;
        created_by_id: number | null;
        updated_at_id: number | null;
      }[] = [];
      if (missingSizeNames.length > 0) {
        await prisma.sizes.createMany({
          data: missingSizeNames.map((name) => ({ name })),
          skipDuplicates: true, // In case of race conditions
        });

        // Fetch the newly created sizes to get their IDs
        newSizes = await prisma.sizes.findMany({
          where: {
            name: {
              in: missingSizeNames,
            },
          },
        });
      }

      // Combine existing and new sizes
      const allSizes = [...existingSizes, ...newSizes];
      const sizeMap = new Map(allSizes.map((size) => [size.name, size.id]));

      // STEP 4 — recreate product colours + stock
      for (const colourItem of input.product_colours) {
        const productColour = await prisma.product_colour.create({
          data: {
            colour: colourItem.colour,
            image_url: colourItem.image_url,
            product_id: input.id,
          },
        });

        // Create stock records using the comprehensive size map
        await prisma.product_stock.createMany({
          data: colourItem.stock.map((s: any) => ({
            product_colour_id: productColour.id,
            size_id: sizeMap.get(s.size)!,
            stock: Number(s.stock),
          })),
        });
      }
    }

    return await this.getProductById(input.id);
  }

  async createProductColours(
    product_id: number,
    colourInputs: ProductColourInput[],
  ) {
    // Get all unique size names across all colour inputs
    const allSizeNames = [
      ...new Set(
        colourInputs.flatMap((input) => input.stock.map((s) => s.size)),
      ),
    ];

    // Fetch existing sizes
    const existingSizes = await prisma.sizes.findMany({
      where: {
        name: {
          in: allSizeNames,
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    // Find missing size names
    const existingSizeNames = new Set(existingSizes.map((size) => size.name));
    const missingSizeNames = allSizeNames.filter(
      (name) => !existingSizeNames.has(name),
    );

    // Create missing sizes
    let newSizes: { id: number; name: string }[] = [];
    if (missingSizeNames.length > 0) {
      await prisma.sizes.createMany({
        data: missingSizeNames.map((name) => ({ name })),
        skipDuplicates: true, // In case of race conditions
      });

      // Fetch the newly created sizes to get their IDs
      newSizes = await prisma.sizes.findMany({
        where: {
          name: {
            in: missingSizeNames,
          },
        },
        select: {
          id: true,
          name: true,
        },
      });
    }

    // Combine existing and new sizes
    const allSizes = [...existingSizes, ...newSizes];

    // Create a map for quick lookup
    const sizeNameToIdMap = new Map(
      allSizes.map((size) => [size.name, size.id]),
    );

    const colourStocks = [];
    for (let input of colourInputs) {
      const { colour, image_url } = input;

      const colourStock = await prisma.product_colour.create({
        data: {
          colour,
          image_url,
          product: { connect: { id: product_id } },
          sizes: {
            createMany: {
              data: input.stock.map((s) => ({
                size_id: sizeNameToIdMap.get(s.size)!,
                stock: s.stock,
              })),
            },
          },
        },
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
      include: this._include,
    });

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
          stock: s.stock,
        })),
      })),
    };
    return transformed;
  }

  async getProductsByMarketId(marketId: number) {
    return prisma.products.findFirst({
      where: {
        market_id: marketId,
        deleted: false,
      },
      include: {
        product_category: true,
        product_type: true,
      },
    });
  }

  async listProducts(filters?: ProductFilters) {
  const now = new Date();

  const where = {
    name: filters?.name
      ? {
          contains: filters.name,
        }
      : undefined,
    deleted: filters?.deleted || false,
    status: {
      not: "draft",
      equals: filters?.status,
    },
    product_type_id: filters?.product_type ?? undefined,
    product_category_id: filters?.product_category ?? undefined,
    market: {
      deleted: false,
      OR: [
        { end_date: null }, 
        { end_date: { gte: now } },
      ],
    },
  };

  const all_products = await prisma.products.findMany({
    where,
    include: {
      product_colours: {
        include: {
          sizes: {
            include: {
              size: {
                select: { name: true },
              },
            },
          },
        },
      },
      product_category: true,
      product_type: true,
      market: true,
    },
    take: filters?.take,
    skip: filters?.skip,
  });

  // Transform for frontend
  const transformed = all_products
    .filter((product) => product.product_category?.deleted != true)
    .map((product) => ({
      ...product,
      product_colours: product.product_colours.map((colour) => ({
        colour: colour.colour,
        image_url: colour.image_url,
        stock: colour.sizes.map((s) => ({
          size: s.size.name,
          stock: s.stock,
        })),
      })),
    }));

  return transformed;
}

  async listProductsByMarketId(market_id: number, filters?: ProductFilters) {
    //to fix the filters later
    const all_products = await prisma.products.findMany({
      where: { deleted: false, market_id },
      include: {
        product_colours: {
          include: {
            sizes: {
              include: {
                size: {
                  select: { name: true },
                },
              },
            },
          },
        },
        product_category: true,
        product_type: true,
      },
      take: filters?.take,
      skip: filters?.skip,
    });

    const transformed = all_products
      .filter((product) => product.product_category?.deleted != true)
      .map((product) => ({
        ...product,
        product_colours: product.product_colours.map((colour) => ({
          colour: colour.colour,
          image_url: colour.image_url,
          stock: colour.sizes.map((s) => ({
            size: s.size.name,
            stock: s.stock,
          })),
        })),
      }));

    return transformed;
  }

  private async updateDeletedOnProduct(product_id: number, deleted: boolean) {
    return prisma.products.update({
      where: {
        id: product_id,
      },
      data: {
        deleted,
      },
    });
  }

  private connectProductType(input: CreateProductInput | UpdateProductInput) {
    return input.product_type_id
      ? { connect: { id: Number(input.product_type_id) } }
      : undefined;
  }

  private connectProductCategory(
    input: CreateProductInput | UpdateProductInput,
  ) {
    return input.product_category_id
      ? { connect: { id: Number(input.product_category_id) } }
      : undefined;
  }

  async createSize(name: string, sort_order: number) {
    return prisma.sizes.create({
      data: {
        name,
        sort_order,
      },
    });
  }

  async updateSize(id: number, name: string, sort_order: number) {
    return prisma.sizes.update({
      where: { id },
      data: {
        name,
        sort_order,
      },
    });
  }

  async listSizes() {
    return prisma.sizes.findMany();
  }

  async marketCheck(id?: number) {
    return prisma.markets.findFirst({ where: { id } });
  }

  async createProductType(name: string) {
    const check = await this.getProductTypeByExistingName(name);
    if (check) {
      if (!check.deleted) {
        throw new Error("Product type exists with given name");
      }
      return prisma.product_type.update({
        where: {
          id: check.id,
        },
        data: {
          deleted: false,
          name,
        },
      });
    }
    return prisma.product_type.create({
      data: {
        name: name.trim(),
      },
    });
  }

  async updateProductType(id: number, name: string) {
    const check = await this.getProductTypeByExistingName(name);
    if (check) {
      if (!check.deleted) {
        throw new Error("Product type exists with given name");
      }
      await prisma.product_type.update({
        where: {
          id: check.id,
        },
        data: {
          name: "",
        },
      });
    }
    return prisma.product_type.update({ where: { id }, data: { name } });
  }

  async deleteProductType(id: number) {
    return prisma.product_type.update({
      where: { id },
      data: { deleted: true },
    });
  }

  async restoreProductType(id: number) {
    return prisma.product_type.update({
      where: { id },
      data: { deleted: false },
    });
  }

  async listProductTypes() {
    return prisma.product_type.findMany({
      where: { deleted: false },
    });
  }

  async createProductCategory(name: string) {
    const check = await this.getProductCategoryByExistingName(name);
    if (check) {
      if (!check.deleted) {
        throw new Error("Product category exists with given name");
      }
      return prisma.product_category.update({
        where: {
          id: check.id,
        },
        data: {
          deleted: false,
          name,
        },
      });
    }
    return prisma.product_category.create({
      data: {
        name: name.trim(),
      },
    });
  }

  async updateProductCategory(id: number, name: string) {
    const check = await this.getProductCategoryByExistingName(name);
    if (check) {
      if (!check.deleted) {
        throw new Error("Product category exists with given name");
      }
      await prisma.product_category.update({
        where: {
          id: check.id,
        },
        data: {
          name: "",
        },
      });
    }
    return prisma.product_category.update({ where: { id }, data: { name } });
  }

  async deleteProductCategory(id: number) {
    return prisma.product_category.update({
      where: { id },
      data: { deleted: true },
    });
  }

  async restoreProductCategory(id: number) {
    return prisma.product_category.update({
      where: { id },
      data: { deleted: false },
    });
  }

  async listProductCategories() {
    return prisma.product_category.findMany({
      where: { deleted: false },
    });
  }

  async getProductTypeByExistingName(name: string) {
    return prisma.product_type.findFirst({
      where: {
        name,
      },
    });
  }

  async getProductCategoryByExistingName(name: string) {
    return prisma.product_category.findFirst({
      where: {
        name,
      },
    });
  }
}
