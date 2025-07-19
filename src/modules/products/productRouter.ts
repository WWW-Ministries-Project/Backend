import Router from "express";
import {ProductController} from './productController';

const productRouter = Router();
const productController = new ProductController();
//sizes
productRouter.post("/size", productController.createSize);
productRouter.put("/size", productController.updateSize);
productRouter.get("/sizes", productController.listSizes);
//products
productRouter.post("/", productController.createProduct);
productRouter.put("/", productController.updateProduct);
productRouter.delete("/:productId", productController.deleteProduct);
productRouter.put("/restore/:productId", productController.restoreProduct);
productRouter.get("/list", productController.listProducts);
productRouter.get("/:productId", productController.getProductById);

export default productRouter;