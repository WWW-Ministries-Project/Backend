import Router from "express";
import {ProductController} from "./productController";

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
//product type
productRouter.post("/create-product-type", productController.createProductType);
productRouter.put("/update-product-type", productController.updateProductType);
productRouter.delete("/delete-product-type", productController.deleteProductType);
productRouter.put("/restore-product-type", productController.restoreProductType);
productRouter.get("/list-product-type", productController.listProductTypes);
//product category
productRouter.post("/create-product-category", productController.createProductCategory);
productRouter.put("/update-product-category", productController.updateProductCategory);
productRouter.delete("/delete-product-category", productController.deleteProductCategory);
productRouter.put("/restore-product-category", productController.restoreProductCategory);
productRouter.get("/list-product-category", productController.listProductCategories);

export default productRouter;