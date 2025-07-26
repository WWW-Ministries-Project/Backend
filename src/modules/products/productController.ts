import {Request, Response} from 'express';
import {ProductService} from './productService';

const productService = new ProductService();

export class ProductController {
    async createProduct(req: Request, res: Response) {
        try {
            const product = await productService.createProduct(req.body);
            return res
                .status(200)
                .json({message: "Product Created Successfully", data: product});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to create product: " + error.message})
        }
    }

    async updateProduct(req: Request, res: Response) {
        try {
            const product = await productService.updateProduct(req.body);
            return res
                .status(200)
                .json({message: "Product Updated Successfully", data: product});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to update product: " + error.message})
        }
    }

    async deleteProduct(req: Request, res: Response) {
        try {
            const product = await productService.softDeleteProduct(req.body.product_id);
            return res
                .status(200)
                .json({message: "Product Deleted Successfully", data: product});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to delete product: " + error.message})
        }
    }

    async restoreProduct(req: Request, res: Response) {
        try {
            const product = await productService.restoreProduct(req.body.product_id);
            return res
                .status(200)
                .json({message: "Product Restored Successfully", data: product});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to restore product: " + error.message})
        }
    }

    async getProductById(req: Request, res: Response) {
        try {
            const product = await productService.getProductById(req.body.product_id);
            return res
                .status(200)
                .json({data: product});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to fetch product: " + error.message})
        }
    }

    async getProductByMarketId(req: Request, res: Response) {
        try {
            const {market_id} = req.query;
            const product = await productService.getProductById(Number(market_id));
            return res
                .status(200)
                .json({data: product});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to fetch product: " + error.message})
        }
    }

    async listProducts(req: Request, res: Response) {
        try {
            const product = await productService.listProducts(req.body.filters);
            return res
                .status(200)
                .json({data: product});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to fetch product: " + error.message})
        }
    }

    async createSize(req: Request, res: Response) {
        try {
            const {name, sort_order} = req.body;
            const product = await productService.createSize(name, sort_order);
            return res
                .status(200)
                .json({data: product});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to create size: " + error.message})
        }
    }

    async updateSize(req: Request, res: Response) {
        try {
            const {id, name, sort_order} = req.body;
            const product = await productService.updateSize(id, name, sort_order);
            return res
                .status(200)
                .json({data: product});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to create size: " + error.message})
        }
    }

    async listSizes(req: Request, res: Response) {
        try {
            const sizes = await productService.listSizes();
            return res
                .status(200)
                .json({data: sizes});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to create size: " + error.message})
        }
    }

    async createProductType(req: Request, res: Response) {
        try {
            const {name} = req.body;
            const productType = await productService.createProductType(name);
            return res
                .status(200)
                .json({data: productType});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to create product type: " + error.message})
        }
    }

    async updateProductType(req: Request, res: Response) {
        try {
            const {id, name} = req.body;
            const productType = await productService.updateProductType(id, name);
            return res
                .status(200)
                .json({data: productType});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to update product type: " + error.message})
        }
    }

    async deleteProductType(req: Request, res: Response) {
        try {
            const {id} = req.body;
            const productType = await productService.deleteProductType(id);
            return res
                .status(200)
                .json({data: productType});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to delete product type: " + error.message})
        }
    }

    async restoreProductType(req: Request, res: Response) {
        try {
            const {id} = req.body;
            const productType = await productService.restoreProductType(id);
            return res
                .status(200)
                .json({data: productType});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to restore product type: " + error.message})
        }
    }

    async listProductTypes(req: Request, res: Response) {
        try {
            const productTypes = await productService.listProductTypes();
            return res
                .status(200)
                .json({data: productTypes});
        } catch (error: any) {
            return res.status(500).json({message: "Failed to get product types: " + error.message})
        }
    }
}