import Router from "express";
import {ProductController} from './productController';

const productRouter = Router();
const productController = new ProductController();
//sizes
productRouter.post("/create-size", productController.createSize);
productRouter.put("/update-size", productController.updateSize);
productRouter.get("/list-sizes", productController.listSizes);
//products
productRouter.post("/create-product", productController.createProduct);
productRouter.put("/update-product", productController.updateProduct);
productRouter.delete("/delete-product", productController.deleteProduct);
productRouter.put("/restore-product", productController.restoreProduct);
productRouter.get("/list-products", productController.listProducts);
productRouter.get("/get-product-by-id", productController.getProductById);

export default productRouter;